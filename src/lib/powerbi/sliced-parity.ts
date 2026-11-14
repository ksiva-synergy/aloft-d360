import 'server-only';

/**
 * Sliced parity runner: evaluates a measure per member of an automatically chosen dimension in
 * Power BI (SUMMARIZECOLUMNS) and in SQL (the measure in the row context of each dimension row),
 * and compares member by member (see slicing.ts).
 */

import prisma from '@/lib/db';
import { executeDatasetQueries } from '@/lib/powerbi/client';
import { daxColumn, daxTable } from '@/lib/powerbi/dax-print';
import { compileRowExpressionsToSql } from '@/lib/powerbi/dax-sql-compile';
import { executeDaxQueries } from '@/lib/powerbi/execute-dax';
import { resolveModelConnectionId } from '@/lib/powerbi/expand-validate';
import { loadMeasureLogicCatalog, type MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph, type ModelGraph } from '@/lib/powerbi/model-graph';
import { type SliceComparison, chooseSliceDimension, compareSlices } from '@/lib/powerbi/slicing';
import { runPbiSql } from '@/lib/powerbi/warehouse-exec';

/** Members compared at most (dimensions larger than this are cut, and the cut is reported). */
export const SLICE_MAX_MEMBERS = 5000;

export type SliceContext = {
  catalog: MeasureLogicCatalog;
  graph: ModelGraph;
  model: { workspaceId: string; datasetId: string; rls: boolean };
  connectionId: string | null;
};

export async function loadSliceContext(orgId: string, modelId: string): Promise<SliceContext> {
  const m = await prisma.pbiModel.findFirst({
    where: { id: modelId, org_id: orgId },
    select: { pbi_model_id: true, rls_required: true, workspace: { select: { pbi_workspace_id: true } } },
  });
  if (!m) throw new Error('Model not found');
  const catalog = await loadMeasureLogicCatalog(orgId, modelId);
  return {
    catalog,
    graph: buildModelGraph(catalog),
    model: { workspaceId: m.workspace.pbi_workspace_id, datasetId: m.pbi_model_id, rls: m.rls_required === true },
    connectionId: await resolveModelConnectionId(orgId, modelId),
  };
}

export async function runSlicedParity(
  orgId: string,
  measure: string,
  ctx: SliceContext,
): Promise<SliceComparison | { skipped: string }> {
  const dim = chooseSliceDimension(measure, ctx.catalog, ctx.graph);
  if (!dim) return { skipped: 'no related dimension to slice by' };
  if (!ctx.connectionId) return { skipped: 'no Databricks connection' };

  // Power BI: one row per member with a non-blank value
  const col = daxColumn(dim.table, dim.column);
  const query = `EVALUATE SUMMARIZECOLUMNS(${col}, "v", ${daxColumn(null, measure)})`;
  let pbiRows: Record<string, unknown>[];
  try {
    if (ctx.model.rls) {
      pbiRows = (await executeDaxQueries(ctx.model.workspaceId, ctx.model.datasetId, query, { rowLimit: SLICE_MAX_MEMBERS }))[0]?.rows ?? [];
    } else {
      const res = await executeDatasetQueries(ctx.model.workspaceId, ctx.model.datasetId, [query]);
      const block = res.results?.[0];
      if (block?.error) return { skipped: `Power BI: ${block.error.message ?? 'error'}`.slice(0, 300) };
      pbiRows = (block?.tables?.[0]?.rows ?? []) as Record<string, unknown>[];
    }
  } catch (e) {
    return { skipped: `Power BI: ${(e as Error).message.slice(0, 300)}` };
  }
  const keyName = (row: Record<string, unknown>) =>
    Object.keys(row).find((k) => k !== '[v]' && k !== 'v') ?? `${daxTable(dim.table)}[${dim.column}]`;
  const powerBi = pbiRows.map((r) => ({ key: r[keyName(r)], value: r['[v]'] ?? r.v }));

  // SQL: the measure in the row context of each dimension row (unique key → per member)
  const compiled = compileRowExpressionsToSql({
    tableName: dim.table,
    exprs: [daxColumn(null, measure)],
    idColumn: dim.column,
    catalog: ctx.catalog,
  });
  if (!compiled.ok) return { skipped: `compile: ${compiled.reason.slice(0, 300)}` };
  const run = await runPbiSql({
    orgId,
    connectionId: ctx.connectionId,
    sql: compiled.sql,
    mode: 'execute',
    purpose: 'pbi_sliced_parity',
    rowLimit: SLICE_MAX_MEMBERS,
    useCache: false,
  });
  if (run.status !== 'ok') return { skipped: `SQL ${run.status}: ${run.error.slice(0, 300)}` };
  const sql = run.rows.map((r) => ({ key: r[dim.column], value: r.r0 }));
  return compareSlices({ dimension: dim, powerBi, sql });
}
