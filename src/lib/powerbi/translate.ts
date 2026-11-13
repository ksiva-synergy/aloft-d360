import 'server-only';

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
  isPbiTranslateLlmAvailable,
  translateMeasureWithLlm,
} from '@/lib/powerbi/translate-llm';
import { validateSqlAgainstAllowlist } from '@/lib/powerbi/translate-llm-validate';
import { tryRuleTierSql } from '@/lib/powerbi/translate-rule';

type MeasureRow = Awaited<ReturnType<typeof loadMeasures>>[number];

type LlmCandidate = {
  measure: MeasureRow;
  uc: string;
  sourceTable: string;
  nativeSql: string | null;
  via: 'home_table' | 'dax_ref';
  columnResolution: MeasureColumnResolution;
};

async function loadMeasures(orgId: string, modelIds?: string[]) {
  return prisma.pbiMeasure.findMany({
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
): Record<string, unknown> {
  return {
    uc_full_path: uc,
    uc_resolve_via: via,
    uc_source_table: sourceTable,
    ...extra,
  };
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
  const modelTableUc = await loadModelTableUcMaps(orgId, internalModelIds);
  const catalogByModel = await loadCatalogByModel(orgId, internalModelIds);

  let ruleTranslated = 0;
  let skippedNoBinding = 0;
  let skippedUnsupported = 0;
  let ucViaDaxRefs = 0;
  const llmCandidates: LlmCandidate[] = [];

  for (const measure of measures) {
    const binding = measure.table.sourceBinding;
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
      continue;
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
      });
    };

    if (!attempt) {
      passRuleToLlm();
      continue;
    }

    const ruleCheck = validateSqlAgainstAllowlist(
      attempt.sql,
      columnResolution.allowed_columns,
    );
    if (!ruleCheck.ok) {
      passRuleToLlm();
      continue;
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
        run_id: opts.runId,
        props: translationProps(resolved.uc, resolved.via, resolved.sourceTable, {
          pattern: attempt.pattern,
          ...colProps,
        }),
      },
      update: {
        measure_name: measure.name,
        dax_hash: measure.dax_hash,
        sql_text: attempt.sql,
        tier: 'rule',
        status: 'draft',
        run_id: opts.runId,
        props: translationProps(resolved.uc, resolved.via, resolved.sourceTable, {
          pattern: attempt.pattern,
          ...colProps,
        }),
        updated_at: new Date(),
      },
    });
    ruleTranslated += 1;
  }

  const llmEnabled = opts.llmEnabled !== false && isPbiTranslateLlmAvailable();
  const maxLlm = opts.maxLlmMeasures ?? defaultMaxLlmMeasures(opts.pilot);

  let llmTranslated = 0;
  let llmFailed = 0;
  let llmSkippedCap = 0;
  let llmSkippedUnavailable = 0;
  let llmInputTokens = 0;
  let llmOutputTokens = 0;

  if (!llmEnabled && llmCandidates.length > 0) {
    llmSkippedUnavailable = llmCandidates.length;
  } else {
    for (const cand of llmCandidates) {
      if (maxLlm > 0 && llmTranslated >= maxLlm) {
        llmSkippedCap += 1;
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
        });
        if (!result) {
          llmFailed += 1;
          continue;
        }

        const colProps = columnResolutionProps(cand.columnResolution);
        const allowCheck = validateSqlAgainstAllowlist(
          result.sql,
          cand.columnResolution.allowed_columns,
        );
        if (!allowCheck.ok) {
          console.warn(
            `[pbi_translate] llm sql allowlist reject measure=${cand.measure.name} invalid=${allowCheck.invalid.join(',')}`,
          );
          llmFailed += 1;
          continue;
        }

        llmInputTokens += result.inputTokens;
        llmOutputTokens += result.outputTokens;

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
            run_id: opts.runId,
            props: translationProps(cand.uc, cand.via, cand.sourceTable, {
              grain: result.grain,
              assumptions: result.assumptions,
              explanation: result.explanation,
              llm_model_id: result.modelId,
              prompt_version: result.promptVersion,
              ...colProps,
            }),
          },
          update: {
            measure_name: cand.measure.name,
            dax_hash: cand.measure.dax_hash,
            sql_text: result.sql,
            tier: 'llm',
            status: 'draft',
            run_id: opts.runId,
            props: translationProps(cand.uc, cand.via, cand.sourceTable, {
              grain: result.grain,
              assumptions: result.assumptions,
              explanation: result.explanation,
              llm_model_id: result.modelId,
              prompt_version: result.promptVersion,
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
      }
    }
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
    uc_via_dax_refs: ucViaDaxRefs,
    llm_input_tokens: llmInputTokens,
    llm_output_tokens: llmOutputTokens,
    cost_usd: costUsd,
    run_id: opts.runId,
  };
}
