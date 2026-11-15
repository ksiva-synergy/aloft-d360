import 'server-only';

import prisma from '@/lib/db';
import { systemPrincipal } from '@/lib/access/principal';
import { createHeartbeat } from '@/lib/powerbi/job-health';
import { runPbiSql } from '@/lib/powerbi/warehouse-exec';
import { type SliceContext, loadSliceContext, runSlicedParity } from '@/lib/powerbi/sliced-parity';
import { type StaleState, decideFreshness } from '@/lib/powerbi/freshness';
import { DriftCache } from '@/lib/powerbi/freshness-probe';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';
import {
  decideTypedParity,
  extractOracleValue,
  extractSqlValue,
  type ParityRaw,
  type ParityVerdict,
} from '@/lib/powerbi/parity-compare';

async function resolveDatabricksSourceIdForTranslation(
  orgId: string,
  tr: {
    model_id: string;
    measure_id: string | null;
    props: unknown;
    measure?: {
      table: {
        sourceBinding: { databricks_source_id: string | null } | null;
      } | null;
    } | null;
  },
): Promise<string | null> {
  const props = (tr.props ?? {}) as Record<string, unknown>;
  const ucTable = typeof props.uc_source_table === 'string' ? props.uc_source_table : null;
  if (ucTable) {
    const rows = await prisma.pbiTable.findMany({
      where: { org_id: orgId, model_id: tr.model_id },
      select: {
        name: true,
        sourceBinding: { select: { databricks_source_id: true } },
      },
    });
    const hit = rows.find((r) => normalizePbiTableName(r.name) === normalizePbiTableName(ucTable));
    const ucSource = hit?.sourceBinding?.databricks_source_id;
    if (ucSource) return ucSource;
  }

  const home = tr.measure?.table?.sourceBinding?.databricks_source_id;
  if (home) return home;

  const anyBinding = await prisma.pbiSourceBinding.findFirst({
    where: {
      org_id: orgId,
      bind_status: 'matched',
      databricks_source_id: { not: null },
      table: { is: { model_id: tr.model_id } },
    },
    select: { databricks_source_id: true },
  });
  return anyBinding?.databricks_source_id ?? null;
}

export interface PbiParityResult {
  translations_checked: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  /** Differ from Power BI because the dataset is older than the warehouse (re-checked after refresh). */
  stale: number;
  run_id: string;
  note?: string;
}

export async function runPbiParity(
  orgId: string,
  _sourceId: string,
  opts: { runId: string; modelIds?: string[] },
): Promise<PbiParityResult> {
  const translations = await prisma.pbiTranslation.findMany({
    where: {
      org_id: orgId,
      sql_text: { not: null },
      ...(opts.modelIds?.length
        ? { model: { pbi_model_id: { in: opts.modelIds } } }
        : {}),
    },
    include: {
      model: { select: { rls_required: true } },
      measure: {
        select: {
          id: true,
          table_id: true,
          table: {
            select: {
              sourceBinding: {
                select: { databricks_source_id: true },
              },
            },
          },
        },
      },
    },
  });

  const heartbeat = createHeartbeat(opts.runId);
  let slicedBudget = Math.max(0, Number(process.env.PBI_SLICED_MAX ?? '40') || 0);
  // Wall-clock budget for member-level checks in one run (2026-11-15: ~4 min per measure on an
  // RLS model made a 31-measure Compare take ~2 h). Past it, measures are judged on totals.
  const slicedRunBudgetMs = Number(process.env.PBI_SLICED_RUN_BUDGET_MS ?? 15 * 60_000);
  let slicedSpentMs = 0;
  const sliceContexts = new Map<string, SliceContext>();
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errors = 0;
  let stale = 0;
  const driftCaches = new Map<string, DriftCache>();
  const principal = systemPrincipal('harvest', orgId);

  for (const tr of translations) {
    if (!tr.sql_text?.trim() || !tr.measure_id) {
      skipped += 1;
      continue;
    }

    const oracle = await prisma.pbiOracleResult.findFirst({
      where: { org_id: orgId, measure_id: tr.measure_id },
      orderBy: { created_at: 'desc' },
    });

    const oracleRaw: ParityRaw = oracle
      ? extractOracleValue(oracle.result_preview)
      : { present: false, raw: null };

    // Nothing to compare against: do not spend warehouse time executing the SQL.
    // (CII run 2026-11-14: ~170 heavy queries ran for RLS models whose oracle was skipped.)
    if (!oracleRaw.present) {
      const rls = tr.model?.rls_required === true;
      await prisma.pbiTranslation.update({
        where: { id: tr.id },
        data: {
          parity_verdict: 'skipped',
          props: {
            ...(tr.props as object),
            parity: {
              verdict: 'skipped',
              summary: rls
                ? 'No Power BI value: the model requires row-level security, so the oracle needs an RLS identity'
                : 'No Power BI value in the latest oracle snapshot',
              no_oracle_reason: rls ? 'rls' : 'missing',
              checked_at: new Date().toISOString(),
              run_id: opts.runId,
            },
          },
          updated_at: new Date(),
        },
      });
      skipped += 1;
      continue;
    }

    const ctxSourceId = await resolveDatabricksSourceIdForTranslation(orgId, tr);
    if (!ctxSourceId) {
      await prisma.pbiTranslation.update({
        where: { id: tr.id },
        data: {
          parity_verdict: 'skipped',
          props: {
            ...(tr.props as object),
            parity: {
              verdict: 'skipped',
              summary: 'No databricks_source_id on UC/home table binding',
              run_id: opts.runId,
            },
          },
          updated_at: new Date(),
        },
      });
      skipped += 1;
      continue;
    }

    const ctxSource = await prisma.platformContextSource.findFirst({
      where: { id: ctxSourceId, org_id: orgId, connection_kind: 'databricks' },
      select: { connection_ref: true },
    });
    const connectionId = ctxSource?.connection_ref;
    if (!connectionId) {
      skipped += 1;
      continue;
    }

    let sqlRaw: ParityRaw = { present: false, raw: null };
    let sqlError: string | null = null;

    // Architecture v2 L3: async polling + explicit budget; outcome classified, transient retried.
    const exec = await runPbiSql({
      orgId,
      connectionId,
      sql: tr.sql_text,
      mode: 'execute',
      purpose: 'pbi_parity',
      useCache: false,
    });
    if (exec.status === 'ok') {
      sqlRaw = extractSqlValue(exec.rows);
    } else {
      sqlError = `${exec.status}: ${exec.error}`;
    }
    await heartbeat({ checked: passed + failed + skipped + errors + 1, total: translations.length });

    const decision = decideTypedParity({ oracle: oracleRaw, sql: sqlRaw });
    let verdict: ParityVerdict | 'stale' = sqlError ? 'error' : decision.verdict;
    let summary = sqlError ? `SQL error: ${sqlError.slice(0, 200)}` : decision.summary;
    const asJson = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);

    // Sliced parity: a matching total can hide member-level errors that cancel out. Compare per
    // member of a related dimension (chosen from the model) — a member mismatch fails the measure.
    let sliced: unknown = null;
    if (verdict === 'pass' && tr.measure && slicedBudget > 0 && slicedSpentMs >= slicedRunBudgetMs) {
      sliced = { skipped: `run time budget for member checks used (${Math.round(slicedRunBudgetMs / 60_000)} min): judged on the total` };
    } else if (verdict === 'pass' && tr.measure && slicedBudget > 0 && process.env.PBI_SLICED_PARITY !== '0') {
      slicedBudget -= 1;
      const slicedStart = Date.now();
      try {
        let ctx = sliceContexts.get(tr.model_id);
        if (!ctx) {
          ctx = await loadSliceContext(orgId, tr.model_id);
          sliceContexts.set(tr.model_id, ctx);
        }
        const cmp = await runSlicedParity(orgId, tr.measure_name, ctx);
        sliced = cmp;
        if ('mismatched' in cmp && cmp.mismatched > 0) {
          verdict = 'fail';
          summary = `Total matches but ${cmp.mismatched} of ${cmp.compared} ${cmp.dimension.table}[${cmp.dimension.column}] members differ`;
        }
      } catch (e) {
        sliced = { skipped: (e as Error).message.slice(0, 300) };
      }
      slicedSpentMs += Date.now() - slicedStart;
    }

    // Freshness: Power BI answers from its last refresh. A difference is "stale" (not a
    // failure) when a table the measure reads has measurably changed since that refresh; it is
    // re-checked after the next refresh and fails if it keeps differing (freshness.ts).
    let staleState: StaleState | null = null;
    // A known, precise cause wins: Power BI's own value depends on source row order
    // (non-deterministic Table.Distinct) — drift would only mask it.
    const nondeterministic =
      ((((tr.props as Record<string, unknown> | null)?.expand_spec as { warnings?: unknown[] } | undefined)?.warnings) ?? []).length > 0;
    if (verdict === 'fail' && tr.measure && !nondeterministic && process.env.PBI_FRESHNESS_CHECK !== '0') {
      try {
        let ctx = sliceContexts.get(tr.model_id);
        if (!ctx) {
          ctx = await loadSliceContext(orgId, tr.model_id);
          sliceContexts.set(tr.model_id, ctx);
        }
        let cache = driftCaches.get(tr.model_id);
        if (!cache) {
          cache = new DriftCache(orgId, ctx);
          driftCaches.set(tr.model_id, cache);
        }
        const prior = (((tr.props as Record<string, unknown> | null)?.parity as { stale?: StaleState } | undefined)?.stale ?? null);
        const decided = decideFreshness({
          drift: await cache.forMeasure(tr.measure_name),
          prior,
          refreshAt: oracle?.model_refresh_at?.toISOString() ?? null,
          now: new Date().toISOString(),
        });
        if (decided.verdict === 'stale') {
          verdict = 'stale';
          staleState = decided.stale;
          summary = `${decided.summary} Difference: ${summary}`;
        } else if (decided.summary) {
          summary = `${decided.summary}. Difference: ${summary}`;
        }
      } catch (e) {
        console.warn(`[pbi_parity] freshness probe failed for ${tr.measure_name}: ${(e as Error).message}`);
      }
    }

    await prisma.pbiTranslation.update({
      where: { id: tr.id },
      data: {
        parity_verdict: verdict,
        props: {
          ...(tr.props as object),
          parity: {
            verdict,
            summary,
            oracle_value: asJson(decision.oracleValue),
            sql_value: sqlError ? null : asJson(decision.sqlValue),
            model_refresh_at: oracle?.model_refresh_at?.toISOString() ?? null,
            exec_ms: exec.ms,
            exec_outcome: exec.status,
            checked_at: new Date().toISOString(),
            run_id: opts.runId,
            ...(sliced ? { sliced } : {}),
            ...(staleState ? { stale: staleState } : {}),
          },
        },
        updated_at: new Date(),
      },
    });

    if (verdict === 'pass') passed += 1;
    else if (verdict === 'fail') failed += 1;
    else if (verdict === 'error') errors += 1;
    else if (verdict === 'stale') stale += 1;
    else skipped += 1;
  }

  // Nothing compiled to SQL (e.g. every measure reads a source outside the warehouse): a
  // successful no-op, so a chained run still finishes — the reasons live on each translation.
  return {
    ...(translations.length === 0 ? { note: 'No measures with SQL to compare — see each measure’s root cause' } : {}),
    translations_checked: translations.length,
    passed,
    failed,
    skipped,
    errors,
    stale,
    run_id: opts.runId,
  };
}
