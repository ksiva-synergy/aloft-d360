import 'server-only';

/**
 * L5 differential decomposition — execution (Architecture v2, Phase 3).
 * Evaluates every planned probe in Power BI (executeQueries) and in Databricks (compiled SQL),
 * compares them with typed parity, and stores the first differing part on the translation
 * (`props.investigation`), where the root-cause classifier and Estate pick it up.
 */

import prisma from '@/lib/db';
import { executeDatasetQueries } from '@/lib/powerbi/client';
import { executeDaxQueries } from '@/lib/powerbi/execute-dax';
import {
  type Probe,
  type ProbeResult,
  concludeDecomposition,
  planDecomposition,
  probeMatches,
} from '@/lib/powerbi/decompose-plan';
import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import { resolveModelConnectionId } from '@/lib/powerbi/expand-validate';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph } from '@/lib/powerbi/model-graph';
import { extractSqlValue } from '@/lib/powerbi/parity-compare';
import { runPbiSql } from '@/lib/powerbi/warehouse-exec';

export const INVESTIGATION_VERSION = '2026-11-14.1';

export type Investigation = {
  version: string;
  at: string;
  measure: string;
  probes: ProbeResult[];
  first_difference: ProbeResult | null;
  differing: string[];
  conclusion: string;
  ms: number;
};

function rowValue(row: Record<string, unknown> | undefined, key: string): unknown {
  if (!row) return undefined;
  return row[`[${key}]`] ?? row[key];
}

/** Power BI values for all probes: one batched ROW() query, falling back to one query each. */
/** One DAX query → first row, via the JSON API or (RLS models) the Arrow API. */
type RunDax = (query: string) => Promise<{ row?: Record<string, unknown>; error?: string }>;

function daxRunner(workspaceId: string, datasetId: string, rls: boolean): RunDax {
  if (rls) {
    return async (query) => {
      try {
        const sets = await executeDaxQueries(workspaceId, datasetId, query, { queryTimeoutSec: 300 });
        return { row: sets[0]?.rows?.[0] };
      } catch (e) {
        return { error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
      }
    };
  }
  return async (query) => {
    const res = await executeDatasetQueries(workspaceId, datasetId, [query]);
    const block = res.results?.[0];
    if (block?.error) return { error: block.error.message ?? 'Power BI error' };
    return { row: block?.tables?.[0]?.rows?.[0] as Record<string, unknown> | undefined };
  };
}

async function evaluateInPowerBi(
  runDax: RunDax,
  probes: Probe[],
): Promise<Map<string, { value?: unknown; error?: string }>> {
  const out = new Map<string, { value?: unknown; error?: string }>();
  if (!probes.length) return out;
  const batch = `EVALUATE ROW(${probes.map((p, i) => `"p${i}", ${p.dax}`).join(', ')})`;
  try {
    const { row, error } = await runDax(batch);
    if (!error && row) {
      probes.forEach((p, i) => out.set(p.id, { value: rowValue(row, `p${i}`) ?? null }));
      return out;
    }
  } catch {
    /* one bad probe fails the batch — evaluate individually */
  }
  for (const p of probes) {
    try {
      const { row, error } = await runDax(`EVALUATE ROW("v", ${p.dax})`);
      out.set(p.id, error ? { error } : { value: rowValue(row, 'v') ?? null });
    } catch (e) {
      out.set(p.id, { error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
  }
  return out;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

export async function investigateMeasure(input: {
  orgId: string;
  modelId: string;
  measure: string;
  persist?: boolean;
  /** Per-probe SQL budget (default 180 s). */
  budgetMs?: number;
}): Promise<Investigation> {
  const started = Date.now();
  const model = await prisma.pbiModel.findFirst({
    where: { id: input.modelId, org_id: input.orgId },
    select: { pbi_model_id: true, rls_required: true, workspace: { select: { pbi_workspace_id: true } } },
  });
  if (!model) throw new Error('Model not found');

  const catalog = await loadMeasureLogicCatalog(input.orgId, input.modelId);
  const graph = buildModelGraph(catalog);
  const probes = planDecomposition({ measure: input.measure, catalog, graph });
  const connectionId = await resolveModelConnectionId(input.orgId, input.modelId);

  const pbi = await evaluateInPowerBi(
    daxRunner(model.workspace.pbi_workspace_id, model.pbi_model_id, model.rls_required === true),
    probes,
  );
  const sql = new Map<string, { value?: unknown; error?: string }>();
  await pool(probes, 3, async (p) => {
    const compiled = compileMeasureToSql({ measureDax: p.dax, catalog });
    if (!compiled.ok) {
      sql.set(p.id, { error: `compile: ${compiled.reason}` });
      return;
    }
    if (!connectionId) {
      sql.set(p.id, { error: 'no Databricks connection for this model' });
      return;
    }
    const run = await runPbiSql({
      orgId: input.orgId,
      connectionId,
      sql: compiled.sql,
      mode: 'execute',
      purpose: 'pbi_investigate',
      budgetMs: input.budgetMs ?? 180_000,
    });
    if (run.status !== 'ok') sql.set(p.id, { error: `${run.status}: ${run.error.slice(0, 300)}` });
    else sql.set(p.id, { value: extractSqlValue(run.rows).raw });
  });

  const results: ProbeResult[] = probes.map((p) => {
    const a = pbi.get(p.id) ?? { error: 'not evaluated' };
    const b = sql.get(p.id) ?? { error: 'not evaluated' };
    if (a.error !== undefined) return { ...p, pbi: null, sql: b.value ?? null, status: 'pbi_error', error: a.error };
    if (b.error !== undefined) return { ...p, pbi: a.value, sql: null, status: 'sql_error', error: b.error };
    return { ...p, pbi: a.value, sql: b.value, status: probeMatches(p, a.value, b.value) ? 'match' : 'differ' };
  });

  const conclusion = concludeDecomposition(results);
  const investigation: Investigation = {
    version: INVESTIGATION_VERSION,
    at: new Date().toISOString(),
    measure: input.measure,
    probes: results,
    ...conclusion,
    ms: Date.now() - started,
  };

  if (input.persist !== false) {
    const m = await prisma.pbiMeasure.findFirst({
      where: { org_id: input.orgId, model_id: input.modelId, name: input.measure },
      select: { id: true },
    });
    if (m) {
      await prisma.$executeRaw`UPDATE pbi_translations
        SET props = COALESCE(props, '{}'::jsonb) || jsonb_build_object('investigation', ${JSON.stringify(investigation)}::jsonb)
        WHERE org_id = ${input.orgId} AND measure_id = ${m.id}::uuid`;
    }
  }
  return investigation;
}
