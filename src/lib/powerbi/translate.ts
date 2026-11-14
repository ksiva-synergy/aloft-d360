import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import { PowerBiApiError } from '@/lib/powerbi/client';
import {
  normalizePbiTableName,
  resolveUcForMeasure,
  type TableUcRow,
} from '@/lib/powerbi/translate-dax-refs';
import {
  columnResolutionProps,
  loadModelColumnCatalog,
  resolveMeasureColumnContext,
  type MeasureColumnResolution,
  type ModelColumnCatalog,
} from '@/lib/powerbi/catalog-column-resolve';
import {
  estimateHarvestLlmCostUsd,
  getPbiTranslateLlmRouting,
  isPbiTranslateLlmAvailable,
  translateMeasureWithLlm,
} from '@/lib/powerbi/translate-llm';
import {
  analyzeMeasureLogic,
  loadMeasureLogicCatalog,
  measureLogicAnalysisProps,
  type MeasureLogicAnalysis,
} from '@/lib/powerbi/measure-logic-analyze';
import { validateSqlAgainstAllowlist } from '@/lib/powerbi/translate-llm-validate';
import { createHash } from 'node:crypto';

import { COMPILER_VERSION } from '@/lib/powerbi/dax-sql-compile';
import { blockingIssuesFor, buildFidelityReport, type FidelityReport } from '@/lib/powerbi/fidelity-gate';
import { buildModelGraph, measureNodeId, type ModelGraph } from '@/lib/powerbi/model-graph';
import {
  expandAndTestMeasure,
  expandTestMode,
  resolveModelConnectionId,
  testSqlOnWarehouse,
} from '@/lib/powerbi/expand-validate';
import { createHeartbeat, withDbRetry } from '@/lib/powerbi/job-health';
import { validateLlmSql } from '@/lib/powerbi/translate-llm-validate';
import { tryRuleTierSql } from '@/lib/powerbi/translate-rule';

type MeasureRow = Awaited<ReturnType<typeof loadMeasures>>[number];

type LlmCandidate = {
  measure: MeasureRow;
  uc: string;
  sourceTable: string;
  nativeSql: string | null;
  via: 'home_table' | 'dax_ref';
  columnResolution: MeasureColumnResolution;
  measureLogic: MeasureLogicAnalysis;
  compileFailure: Record<string, unknown> | null;
};

/** Run `fn` over items with at most `n` in flight. */
async function runPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

async function loadMeasures(orgId: string, modelIds?: string[]) {
  return prisma.pbiMeasure.findMany({
    // deterministic order: runs are reproducible and checkpoints resume predictably
    orderBy: [{ model_id: 'asc' }, { name: 'asc' }],
    where: {
      org_id: orgId,
      model: {
        lifecycle: 'active',
        ...(modelIds?.length ? { pbi_model_id: { in: modelIds } } : {}),
      },
    },
    include: {
      model: { select: { id: true, name: true } },
      table: {
        select: {
          name: true,
          sourceBinding: {
            select: {
              uc_full_path: true,
              bind_status: true,
              context_object_id: true,
              native_sql: true,
            },
          },
        },
      },
    },
  });
}

async function loadModelTableUcMaps(
  orgId: string,
  internalModelIds: string[],
): Promise<Map<string, Map<string, TableUcRow>>> {
  const tables = await prisma.pbiTable.findMany({
    where: { org_id: orgId, model_id: { in: internalModelIds } },
    select: {
      model_id: true,
      name: true,
      sourceBinding: {
        select: {
          uc_full_path: true,
          bind_status: true,
          native_sql: true,
          context_object_id: true,
        },
      },
    },
  });

  const byModel = new Map<string, Map<string, TableUcRow>>();
  for (const t of tables) {
    const b = t.sourceBinding;
    const uc =
      b?.bind_status === 'matched' && b.uc_full_path?.trim() ? b.uc_full_path.trim() : null;
    if (!uc) continue;
    let m = byModel.get(t.model_id);
    if (!m) {
      m = new Map();
      byModel.set(t.model_id, m);
    }
    m.set(normalizePbiTableName(t.name), {
      uc,
      nativeSql: b?.native_sql ?? null,
      contextObjectId: b?.context_object_id ?? null,
    });
  }
  return byModel;
}

async function loadCatalogByModel(
  orgId: string,
  internalModelIds: string[],
): Promise<Map<string, ModelColumnCatalog>> {
  const out = new Map<string, ModelColumnCatalog>();
  for (const modelId of internalModelIds) {
    const tables = await prisma.pbiTable.findMany({
      where: { org_id: orgId, model_id: modelId },
      select: {
        name: true,
        source_m: true,
        sourceBinding: {
          select: {
            native_sql: true,
            context_object_id: true,
          },
        },
      },
    });
    const rows = tables.map((t) => ({
      name: t.name,
      nativeSql: t.sourceBinding?.native_sql ?? null,
      contextObjectId: t.sourceBinding?.context_object_id ?? null,
      sourceM: t.source_m,
    }));
    out.set(modelId, await loadModelColumnCatalog(orgId, modelId, rows));
  }
  return out;
}

function defaultMaxLlmMeasures(pilot?: boolean): number {
  const env = process.env.PBI_TRANSLATE_LLM_MAX_MEASURES?.trim();
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return pilot ? 12 : 40;
}

function translationProps(
  uc: string,
  via: 'home_table' | 'dax_ref',
  sourceTable: string,
  extra?: Record<string, unknown>,
): Prisma.InputJsonObject {
  return {
    uc_full_path: uc,
    uc_resolve_via: via,
    uc_source_table: sourceTable,
    ...extra,
  } as Prisma.InputJsonObject;
}

export interface PbiTranslateResult {
  measures_scanned: number;
  rule_translated: number;
  llm_translated: number;
  llm_failed: number;
  llm_skipped_cap: number;
  llm_skipped_unavailable: number;
  skipped_no_binding: number;
  skipped_unsupported_dax: number;
  skipped_logic_gate: number;
  pattern_expanded: number;
  expand_compile_failed: number;
  expand_warehouse_failed: number;
  orphan_translations_removed: number;
  skipped_unchanged: number;
  measures_errored: number;
  /** Measures not compiled because the fidelity gate found a blocking input defect. */
  skipped_fidelity: number;
  duration_ms: number;
  uc_via_dax_refs: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  cost_usd: number;
  run_id: string;
}

export async function runPbiTranslate(
  orgId: string,
  sourceId: string,
  opts: {
    runId: string;
    modelIds?: string[];
    maxLlmMeasures?: number;
    llmEnabled?: boolean;
    pilot?: boolean;
    /** Recompile every measure, ignoring checkpoints. */
    force?: boolean;
  },
): Promise<PbiTranslateResult> {
  const source = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId, connection_kind: 'powerbi', status: 'active' },
  });
  if (!source) {
    throw new PowerBiApiError(`No active Power BI context source ${sourceId}`);
  }

  const measures = await loadMeasures(orgId, opts.modelIds);
  const internalModelIds = [...new Set(measures.map((m) => m.model_id))];

  // Re-harvest assigns new measure ids; rows for ids that no longer exist would otherwise
  // linger (the DB has no FK cascade) and shadow the live translation in name-based lookups.
  const orphanCleanup = internalModelIds.length
    ? await prisma.pbiTranslation.deleteMany({
        where: {
          org_id: orgId,
          model_id: { in: internalModelIds },
          measure_id: { not: null, notIn: measures.map((m) => m.id) },
        },
      })
    : { count: 0 };
  if (orphanCleanup.count > 0) {
    console.log(`[pbi_translate] removed ${orphanCleanup.count} translations for deleted measures`);
  }
  const modelTableUc = await loadModelTableUcMaps(orgId, internalModelIds);
  const catalogByModel = await loadCatalogByModel(orgId, internalModelIds);
  const logicCatalogByModel = new Map<string, Awaited<ReturnType<typeof loadMeasureLogicCatalog>>>();
  // L1 model graph + L0 fidelity gate per model (Architecture v2, Phase 2).
  const graphByModel = new Map<string, ModelGraph>();
  const fidelityByModel = new Map<string, FidelityReport>();
  for (const modelId of internalModelIds) {
    const catalog = await loadMeasureLogicCatalog(orgId, modelId);
    logicCatalogByModel.set(modelId, catalog);
    const graph = buildModelGraph(catalog);
    const report = buildFidelityReport(catalog, { graph });
    graphByModel.set(modelId, graph);
    fidelityByModel.set(modelId, report);
    const stored = { ...report, checked_at: new Date().toISOString() };
    await withDbRetry(
      () =>
        prisma.$executeRaw`UPDATE pbi_models SET props = COALESCE(props, '{}'::jsonb) || jsonb_build_object('fidelity', ${JSON.stringify(stored)}::jsonb)
          WHERE id = ${modelId}::uuid`,
      'fidelity',
    );
    if (report.issues.length) {
      console.log(
        `[pbi_translate] fidelity model=${modelId} issues=${JSON.stringify(report.counts)} blocked_measures=${report.blocked.length}`,
      );
    }
  }

  const llmRouting = isPbiTranslateLlmAvailable() ? getPbiTranslateLlmRouting() : null;
  if (llmRouting) {
    console.log(
      `[pbi_translate] llm routing provider=${llmRouting.provider} model=${llmRouting.modelId}`,
    );
  }

  let ruleTranslated = 0;
  let skippedNoBinding = 0;
  let skippedUnsupported = 0;
  let skippedLogicGate = 0;
  let patternExpanded = 0;
  let expandCompileFailed = 0;
  let expandWarehouseFailed = 0;
  let ucViaDaxRefs = 0;
  let skippedUnchanged = 0;
  let measuresErrored = 0;
  let skippedFidelity = 0;
  const llmCandidates: LlmCandidate[] = [];

  // Model fingerprint: compiler version + model definition + UC bindings + verified rules.
  const modelRows = await prisma.pbiModel.findMany({
    where: { id: { in: internalModelIds } },
    select: { id: true, props: true },
  });
  const modelFingerprint = new Map<string, string>();
  for (const m of modelRows) {
    const parse = ((m.props as Record<string, unknown>)?.parse ?? {}) as Record<string, unknown>;
    const bindings = [...(modelTableUc.get(m.id) ?? new Map()).entries()]
      .map(([t, r]) => `${t}=${r.uc}`)
      .sort()
      .join('|');
    const rules = [...(logicCatalogByModel.get(m.id)?.rules?.values() ?? [])]
      .map((r) => `${r.kind}:${r.name}/${r.arity}=${r.sqlTemplate}`)
      .sort()
      .join('|');
    modelFingerprint.set(
      m.id,
      createHash('sha256')
        .update(`${COMPILER_VERSION}\\0${String(parse.definition_hash ?? '')}\\0${bindings}\\0${rules}`)
        .digest('hex')
        .slice(0, 16),
    );
  }
  // Dependency-level fingerprint (Phase 2): compiler version + verified rules + the hash of the
  // measure's own closure in the model graph (its DAX, the measures / calc columns / tables /
  // bindings / warehouse schemas it reads, relationships) + its fidelity blocks. Editing one
  // measure reprocesses only it and the measures that use it. Measures absent from the graph
  // fall back to the model-level fingerprint.
  const rulesHashByModel = new Map<string, string>();
  for (const [modelId, cat] of logicCatalogByModel) {
    rulesHashByModel.set(
      modelId,
      [...(cat?.rules?.values() ?? [])]
        .map((r) => `${r.kind}:${r.name}/${r.arity}=${r.sqlTemplate}`)
        .sort()
        .join('|'),
    );
  }
  const measureFingerprint = (measure: MeasureRow) => {
    const graph = graphByModel.get(measure.model_id);
    const node = graph?.nodes.get(measureNodeId(measure.name));
    const blocks = blockingIssuesFor(fidelityByModel.get(measure.model_id)!, measure.name)
      .map((i) => `${i.kind}@${i.node}`)
      .sort()
      .join('|');
    const basis =
      graph && node
        ? `v2\\0${COMPILER_VERSION}\\0${rulesHashByModel.get(measure.model_id) ?? ''}\\0${graph.dependencyHash(node.id)}\\0${blocks}`
        : `${modelFingerprint.get(measure.model_id) ?? ''}\\0${measure.dax_hash ?? measure.dax}`;
    return createHash('sha256').update(basis).digest('hex').slice(0, 16);
  };
  const previous = new Map<string, { fingerprint?: string; outcome_final?: boolean }>();
  for (const t of await prisma.pbiTranslation.findMany({
    where: { org_id: orgId, model_id: { in: internalModelIds }, measure_id: { not: null } },
    select: { measure_id: true, props: true },
  })) {
    const pr = (t.props ?? {}) as Record<string, unknown>;
    previous.set(t.measure_id!, {
      fingerprint: typeof pr.fingerprint === 'string' ? pr.fingerprint : undefined,
      outcome_final: pr.outcome_final === true,
    });
  }
  const stampCheckpoint = (measureId: string, patchProps: Record<string, unknown>) =>
    withDbRetry(
      () =>
        prisma.$executeRaw`UPDATE pbi_translations SET props = props || ${JSON.stringify(patchProps)}::jsonb
          WHERE org_id = ${orgId} AND measure_id = ${measureId}::uuid`,
      'checkpoint',
    );

  /** Record why a measure has no SQL (shown by recreation summary / Estate). */
  async function persistNoSql(
    measure: MeasureRow,
    tier: string,
    props: Record<string, unknown>,
  ) {
    const data = {
      measure_name: measure.name,
      dax_hash: measure.dax_hash,
      sql_text: null,
      tier,
      status: 'draft',
      parity_verdict: null,
      run_id: opts.runId,
      props: props as object,
    };
    await withDbRetry(
      () =>
        prisma.pbiTranslation.upsert({
          where: { org_id_measure_id: { org_id: orgId, measure_id: measure.id } },
          create: { org_id: orgId, model_id: measure.model_id, measure_id: measure.id, ...data },
          update: { ...data, updated_at: new Date() },
        }),
      'persist',
    );
  }

  type MeasureTaskResult = { final: boolean; telemetry: Record<string, unknown> | null };
  const processMeasure = async (measure: MeasureRow): Promise<MeasureTaskResult> => {
    const result: MeasureTaskResult = { final: true, telemetry: null };
    const binding = measure.table.sourceBinding;
    const logicCatalogForCompile = logicCatalogByModel.get(measure.model_id);
    const tableMapForCompile =
      modelTableUc.get(measure.model_id) ?? new Map<string, TableUcRow>();

    // 0) Fidelity gate: a measure whose dependencies have a blocking input defect (replica drift,
    //    unparseable DAX, leaked TMDL) is not compiled — the defect is recorded as its cause.
    const fidelity = fidelityByModel.get(measure.model_id);
    const blocking = fidelity ? blockingIssuesFor(fidelity, measure.name) : [];
    if (blocking.length) {
      skippedFidelity += 1;
      await persistNoSql(measure, 'fidelity_gate', {
        fidelity_block: {
          gate_version: fidelity!.version,
          reason: `${blocking[0]!.object}: ${blocking[0]!.detail}`,
          issues: blocking,
        },
      });
      return result;
    }

    // 1) Compile-first: DAX → SQL from the harvested model (calc columns, PQ lineage,
    //    calculated tables, relationships, measure refs), tested on the warehouse.
    let compileFailure: Record<string, unknown> | null = null;
    if (logicCatalogForCompile) {
      const compileLogic = analyzeMeasureLogic({
        dax: measure.dax,
        catalog: logicCatalogForCompile,
        hasUc: true,
      });
      const t0 = Date.now();
      const outcome = await expandAndTestMeasure({
        orgId,
        modelId: measure.model_id,
        measureDax: measure.dax,
        measureLogic: compileLogic,
        catalog: logicCatalogForCompile,
        anyStrategy: true,
      });
      const totalMs = Date.now() - t0;
      const testMs = outcome.attempts.reduce((n, a) => n + (a.ms ?? 0), 0);
      const sqlText = outcome.ok ? outcome.expanded.sql : (outcome.sql ?? '');
      result.telemetry = {
        dax_chars: measure.dax.length,
        sql_chars: sqlText.length,
        growth: sqlText.length && measure.dax.length ? Math.round((sqlText.length / measure.dax.length) * 10) / 10 : null,
        ctes: (sqlText.match(/\bAS \(\n/g) ?? []).length,
        compile_ms: Math.max(0, totalMs - testMs),
        test_ms: testMs,
        test_attempts: outcome.attempts.length,
        outcome: outcome.ok
          ? outcome.test.mode === 'deferred'
            ? 'deferred'
            : 'ok'
          : outcome.stage === 'compile'
            ? 'compile_failed'
            : (outcome.warehouseOutcome ?? 'sql_error'),
      };
      if (!outcome.ok && outcome.warehouseOutcome === 'transient') result.final = false;
      const compiledSql = outcome.ok ? validateLlmSql(outcome.expanded.sql) : null;
      if (outcome.ok && compiledSql) {
        const tablesUsed = (outcome.expanded.expand_spec.tables ?? []) as string[];
        const ucTable = tablesUsed.find((t) => tableMapForCompile.get(normalizePbiTableName(t)));
        const uc = ucTable ? tableMapForCompile.get(normalizePbiTableName(ucTable))!.uc : '';
        const props = translationProps(uc, 'dax_ref', ucTable ?? measure.table.name, {
          pattern: outcome.expanded.pattern,
          expand_spec: outcome.expanded.expand_spec,
          expand_test: {
            mode: outcome.test.mode,
            value: outcome.test.value,
            attempts: outcome.attempts,
          },
          ...measureLogicAnalysisProps(compileLogic),
        }) as object;
        const data = {
          measure_name: measure.name,
          dax_hash: measure.dax_hash,
          sql_text: compiledSql,
          tier: 'expand',
          status: 'draft',
          parity_verdict: null,
          run_id: opts.runId,
          props,
        };
        await prisma.pbiTranslation.upsert({
          where: { org_id_measure_id: { org_id: orgId, measure_id: measure.id } },
          create: { org_id: orgId, model_id: measure.model_id, measure_id: measure.id, ...data },
          update: { ...data, updated_at: new Date() },
        });
        patternExpanded += 1;
        return result;
      }
      if (!outcome.ok) {
        if (outcome.stage === 'compile') expandCompileFailed += 1;
        else expandWarehouseFailed += 1;
        compileFailure = {
          stage: outcome.stage,
          warehouse_outcome: outcome.warehouseOutcome ?? null,
          reason: outcome.reason,
          sql: outcome.sql ?? null,
          notes: outcome.notes,
          gap: outcome.gap ?? null,
          attempts: outcome.attempts,
        };
      }
    }

    const homeUc =
      binding?.bind_status === 'matched' && binding.uc_full_path
        ? binding.uc_full_path
        : null;
    const tableMap = modelTableUc.get(measure.model_id) ?? new Map<string, TableUcRow>();

    const resolved = resolveUcForMeasure({
      dax: measure.dax,
      homeTableName: measure.table.name,
      homeUc,
      homeNativeSql: binding?.native_sql ?? null,
      modelTables: tableMap,
    });

    if (!resolved) {
      skippedNoBinding += 1;
      await persistNoSql(measure, 'unresolved', {
        uc_resolution: 'none',
        expand_failure: compileFailure,
      });
      return result;
    }
    if (resolved.via === 'dax_ref') ucViaDaxRefs += 1;

    const catalog = catalogByModel.get(measure.model_id);
    const columnResolution = catalog
      ? await resolveMeasureColumnContext({
          orgId,
          dax: measure.dax,
          ucFullPath: resolved.uc,
          sourceTable: resolved.sourceTable,
          modelTables: tableMap,
          catalog,
        })
      : {
          uc_full_path: resolved.uc,
          context_object_id: null,
          allowed_columns: [],
          dax_refs: [],
          column_map: {},
          unmapped: [],
          mapped_count: 0,
          ref_count: 0,
        };

    const colProps = columnResolutionProps(columnResolution);
    const logicCatalog = logicCatalogByModel.get(measure.model_id);
    const measureLogic = logicCatalog
      ? analyzeMeasureLogic({
          dax: measure.dax,
          catalog: logicCatalog,
          hasUc: Boolean(resolved.uc),
        })
      : analyzeMeasureLogic({ dax: measure.dax, catalog: { columnsByTable: new Map(), tableMeta: new Map() }, hasUc: Boolean(resolved.uc) });
    const logicProps = measureLogicAnalysisProps(measureLogic);

    async function persistLogicGateOnly(extra?: Record<string, unknown>) {
      skippedLogicGate += 1;
      await prisma.pbiTranslation.upsert({
        where: { org_id_measure_id: { org_id: orgId, measure_id: measure.id } },
        create: {
          org_id: orgId,
          model_id: measure.model_id,
          measure_id: measure.id,
          measure_name: measure.name,
          dax_hash: measure.dax_hash,
          sql_text: null,
          tier: 'logic_gate',
          status: 'draft',
          parity_verdict: null,
          run_id: opts.runId,
          props: translationProps(resolved!.uc, resolved!.via, resolved!.sourceTable, {
            ...colProps,
            ...logicProps,
            ...extra,
          }),
        },
        update: {
          measure_name: measure.name,
          dax_hash: measure.dax_hash,
          sql_text: null,
          tier: 'logic_gate',
          status: 'draft',
          parity_verdict: null,
          run_id: opts.runId,
          props: translationProps(resolved!.uc, resolved!.via, resolved!.sourceTable, {
            ...colProps,
            ...logicProps,
            ...extra,
          }),
          updated_at: new Date(),
        },
      });
    }

    if (measureLogic.block_automated_sql) {
      await persistLogicGateOnly(compileFailure ? { expand_failure: compileFailure } : undefined);
      return result;
    }

    const attempt = tryRuleTierSql({
      dax: measure.dax,
      tableName: resolved.sourceTable,
      ucFullPath: resolved.uc,
      columnMap: columnResolution.column_map,
    });

    const passRuleToLlm = () => {
      skippedUnsupported += 1;
      llmCandidates.push({
        measure,
        uc: resolved.uc,
        sourceTable: resolved.sourceTable,
        nativeSql: resolved.nativeSql,
        via: resolved.via,
        columnResolution,
        measureLogic,
        compileFailure,
      });
      result.final = false; // stamped final after the LLM phase
    };

    if (!attempt) {
      passRuleToLlm();
      return result;
    }

    const ruleCheck = validateSqlAgainstAllowlist(
      attempt.sql,
      columnResolution.allowed_columns,
    );
    if (!ruleCheck.ok) {
      passRuleToLlm();
      return result;
    }

    await prisma.pbiTranslation.upsert({
      where: {
        org_id_measure_id: { org_id: orgId, measure_id: measure.id },
      },
      create: {
        org_id: orgId,
        model_id: measure.model_id,
        measure_id: measure.id,
        measure_name: measure.name,
        dax_hash: measure.dax_hash,
        sql_text: attempt.sql,
        tier: 'rule',
        status: 'draft',
        parity_verdict: null,
        run_id: opts.runId,
        props: translationProps(resolved!.uc, resolved!.via, resolved!.sourceTable, {
          pattern: attempt.pattern,
          ...colProps,
          ...logicProps,
        }),
      },
      update: {
        measure_name: measure.name,
        dax_hash: measure.dax_hash,
        sql_text: attempt.sql,
        tier: 'rule',
        status: 'draft',
        parity_verdict: null,
        run_id: opts.runId,
        props: translationProps(resolved!.uc, resolved!.via, resolved!.sourceTable, {
          pattern: attempt.pattern,
          ...colProps,
          ...logicProps,
        }),
        updated_at: new Date(),
      },
    });
    ruleTranslated += 1;    return result;
  };

  // Stable order + checkpoints: a measure whose fingerprint (compiler version + model content +
  // DAX) is unchanged and already reached a final outcome is skipped, so a retried or resumed
  // run continues where it stopped. Measures run through a bounded worker pool so one slow
  // measure cannot stall the run; a failing measure is recorded and never kills the job.
  const concurrency = Math.max(1, Number(process.env.PBI_TRANSLATE_CONCURRENCY ?? '4') || 4);
  const heartbeat = createHeartbeat(opts.runId);
  const startedAt = Date.now();
  let processed = 0;
  await runPool(measures, concurrency, async (measure) => {
    const fp = measureFingerprint(measure);
    const prev = previous.get(measure.id);
    if (!opts.force && prev?.fingerprint === fp && prev?.outcome_final === true) {
      skippedUnchanged += 1;
    } else {
      try {
        const r = await withDbRetry(() => processMeasure(measure), `measure ${measure.name}`);
        await stampCheckpoint(measure.id, {
          fingerprint: fp,
          outcome_final: r.final,
          ...(r.telemetry ? { telemetry: r.telemetry } : {}),
        });
      } catch (err) {
        measuresErrored += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pbi_translate] measure ${measure.name} failed:`, msg.slice(0, 300));
        await persistNoSql(measure, 'error', {
          translate_error: msg.slice(0, 1000),
          fingerprint: fp,
          outcome_final: false,
        }).catch(() => undefined);
      }
    }
    processed += 1;
    const progress = {
      processed,
      total: measures.length,
      expanded: patternExpanded,
      skipped_unchanged: skippedUnchanged,
      skipped_fidelity: skippedFidelity,
      errored: measuresErrored,
      elapsed_s: Math.round((Date.now() - startedAt) / 1000),
    };
    if (processed % 10 === 0 || processed === measures.length) {
      console.log(`[pbi_translate] progress ${JSON.stringify(progress)}`);
    }
    await heartbeat(progress, processed === measures.length);
  });

  const llmEnabled = opts.llmEnabled !== false && isPbiTranslateLlmAvailable();
  const maxLlm = opts.maxLlmMeasures ?? defaultMaxLlmMeasures(opts.pilot);

  let llmTranslated = 0;
  let llmFailed = 0;
  let llmSkippedCap = 0;
  let llmSkippedUnavailable = 0;
  const llmCapped = new Set<string>();
  let llmInputTokens = 0;
  let llmOutputTokens = 0;

  const persistLlmFailure = (cand: LlmCandidate, reason: string) =>
    persistNoSql(
      cand.measure,
      'llm_failed',
      translationProps(cand.uc, cand.via, cand.sourceTable, {
        llm_failure: { reason },
        expand_failure: cand.compileFailure,
        ...columnResolutionProps(cand.columnResolution),
        ...measureLogicAnalysisProps(cand.measureLogic),
      }),
    );

  if (!llmEnabled && llmCandidates.length > 0) {
    llmSkippedUnavailable = llmCandidates.length;
    for (const cand of llmCandidates) await persistLlmFailure(cand, 'LLM translate disabled or unavailable');
  } else {
    for (const cand of llmCandidates) {
      if (maxLlm > 0 && llmTranslated >= maxLlm) {
        llmSkippedCap += 1;
        llmCapped.add(cand.measure.id);
        await persistLlmFailure(cand, `LLM cap reached (${maxLlm} measures per run)`);
        continue;
      }

      try {
        const result = await translateMeasureWithLlm({
          modelName: cand.measure.model.name,
          tableName: cand.sourceTable,
          measureName: cand.measure.name,
          dax: cand.measure.dax,
          ucFullPath: cand.uc,
          nativeSql: cand.nativeSql,
          allowedColumns: cand.columnResolution.allowed_columns,
          columnMap: cand.columnResolution.column_map,
          measureLogicAnalysis: cand.measureLogic as unknown as Record<string, unknown>,
        });
        if (!result) {
          llmFailed += 1;
          await persistLlmFailure(cand, 'LLM returned no usable SQL');
          continue;
        }

        const colProps = {
          ...columnResolutionProps(cand.columnResolution),
          ...measureLogicAnalysisProps(cand.measureLogic),
        };
        const allowCheck = validateSqlAgainstAllowlist(
          result.sql,
          cand.columnResolution.allowed_columns,
        );
        if (!allowCheck.ok) {
          console.warn(
            `[pbi_translate] llm sql allowlist reject measure=${cand.measure.name} invalid=${allowCheck.invalid.join(',')}`,
          );
          llmFailed += 1;
          await persistLlmFailure(
            cand,
            `LLM SQL referenced columns outside the allowlist: ${allowCheck.invalid.join(', ')}`,
          );
          continue;
        }

        llmInputTokens += result.inputTokens;
        llmOutputTokens += result.outputTokens;

        // Same warehouse check as compiler SQL (CII run 2026-11-14: 9 of 12 LLM queries passed the
        // allowlist but failed on Databricks with UNRESOLVED_COLUMN — Power Query-only column names).
        // A timeout defers validation to parity, as for compiler SQL; a SQL error rejects it.
        let llmValidation: 'explain_ok' | 'deferred' | 'not_checked' = 'not_checked';
        const llmConn = await resolveModelConnectionId(orgId, cand.measure.model_id);
        if (llmConn && expandTestMode() !== 'off') {
          const check = await testSqlOnWarehouse({ orgId, connectionId: llmConn, sql: result.sql, mode: 'explain' });
          if (check.ok) llmValidation = 'explain_ok';
          else if (check.kind === 'sql_error') {
            llmFailed += 1;
            await persistLlmFailure(cand, `LLM SQL failed the Databricks check: ${check.error.slice(0, 400)}`);
            continue;
          } else llmValidation = 'deferred';
        }

        await prisma.pbiTranslation.upsert({
          where: {
            org_id_measure_id: { org_id: orgId, measure_id: cand.measure.id },
          },
          create: {
            org_id: orgId,
            model_id: cand.measure.model_id,
            measure_id: cand.measure.id,
            measure_name: cand.measure.name,
            dax_hash: cand.measure.dax_hash,
            sql_text: result.sql,
            tier: 'llm',
            status: 'draft',
            parity_verdict: null,
            run_id: opts.runId,
            props: translationProps(cand.uc, cand.via, cand.sourceTable, {
              grain: result.grain,
              assumptions: result.assumptions,
              explanation: result.explanation,
              llm_model_id: result.modelId,
              prompt_version: result.promptVersion,
              llm_validation: llmValidation,
              ...colProps,
            }),
          },
          update: {
            measure_name: cand.measure.name,
            dax_hash: cand.measure.dax_hash,
            sql_text: result.sql,
            tier: 'llm',
            status: 'draft',
            parity_verdict: null,
            run_id: opts.runId,
            props: translationProps(cand.uc, cand.via, cand.sourceTable, {
              grain: result.grain,
              assumptions: result.assumptions,
              explanation: result.explanation,
              llm_model_id: result.modelId,
              prompt_version: result.promptVersion,
              llm_validation: llmValidation,
              ...colProps,
            }),
            updated_at: new Date(),
          },
        });
        llmTranslated += 1;
      } catch (err) {
        console.error(
          `[pbi_translate] llm failed measure ${cand.measure.name}:`,
          err instanceof Error ? err.message : err,
        );
        llmFailed += 1;
        await persistLlmFailure(
          cand,
          `LLM error: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`,
        );
      }
    }
  }

  // LLM-phase checkpoints: a candidate the LLM processed (success or recorded failure) is final;
  // capped / LLM-unavailable candidates stay non-final so a later run retries them.
  for (const cand of llmCandidates) {
    await stampCheckpoint(cand.measure.id, {
      fingerprint: measureFingerprint(cand.measure),
      outcome_final: llmEnabled && !llmCapped.has(cand.measure.id),
    }).catch(() => undefined);
  }

  const costUsd = estimateHarvestLlmCostUsd(llmInputTokens, llmOutputTokens);

  return {
    measures_scanned: measures.length,
    rule_translated: ruleTranslated,
    llm_translated: llmTranslated,
    llm_failed: llmFailed,
    llm_skipped_cap: llmSkippedCap,
    llm_skipped_unavailable: llmSkippedUnavailable,
    skipped_no_binding: skippedNoBinding,
    skipped_unsupported_dax: skippedUnsupported,
    skipped_logic_gate: skippedLogicGate,
    pattern_expanded: patternExpanded,
    expand_compile_failed: expandCompileFailed,
    expand_warehouse_failed: expandWarehouseFailed,
    orphan_translations_removed: orphanCleanup.count,
    skipped_unchanged: skippedUnchanged,
    measures_errored: measuresErrored,
    skipped_fidelity: skippedFidelity,
    duration_ms: Date.now() - startedAt,
    uc_via_dax_refs: ucViaDaxRefs,
    llm_input_tokens: llmInputTokens,
    llm_output_tokens: llmOutputTokens,
    cost_usd: costUsd,
    run_id: opts.runId,
  };
}
