import 'server-only';

/**
 * Drift probe: for the tables a measure reads, compare the Power BI dataset with the warehouse
 * after Power Query filters — row count (COUNTROWS) and the newest value of up to three date
 * columns (MAX). Aggregates only (counts and dates), no rows. Results are cached per run.
 */

import { executeDatasetQueries } from '@/lib/powerbi/client';
import { daxColumn, daxTable } from '@/lib/powerbi/dax-print';
import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import { executeDaxQueries } from '@/lib/powerbi/execute-dax';
import { type TableDrift, tableDrift } from '@/lib/powerbi/freshness';
import { measureNodeId } from '@/lib/powerbi/model-graph';
import { extractSqlValue } from '@/lib/powerbi/parity-compare';
import type { SliceContext } from '@/lib/powerbi/sliced-parity';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';
import { runPbiSql } from '@/lib/powerbi/warehouse-exec';

const MAX_DATE_COLUMNS = 3;
/** Warehouse budget of one probe query: drift evidence must be cheap or it is skipped. */
const PROBE_BUDGET_MS = Number(process.env.PBI_FRESHNESS_PROBE_BUDGET_MS ?? 30_000);
const tkey = (t: string) => normalizePbiTableName(t).toLowerCase();

/** Warehouse-bound tables in a measure's dependency closure (display names). */
export function tablesReadBy(measure: string, ctx: SliceContext): string[] {
  const closure = ctx.graph.closure(measureNodeId(measure));
  const out: string[] = [];
  for (const [k, meta] of ctx.catalog.tableMeta) {
    if (meta.uc_full_path && closure.has(`t:${k}`)) out.push(meta.displayName);
  }
  return out.sort();
}

function dateColumns(table: string, ctx: SliceContext): string[] {
  const cols = ctx.catalog.columnsByTable.get(tkey(table));
  if (!cols) return [];
  const seen = new Map<string, string>();
  for (const [name, c] of cols) {
    if (c.calculated_dax?.trim() || !/date/i.test(c.data_type ?? '')) continue;
    const lk = name.toLowerCase();
    // the map holds both the original and the lower-case name: keep the original spelling
    if (!seen.has(lk) || seen.get(lk) === lk) seen.set(lk, name);
  }
  return [...seen.values()].sort().slice(0, MAX_DATE_COLUMNS);
}

async function powerBiAggregates(table: string, dates: string[], ctx: SliceContext): Promise<Record<string, unknown> | null> {
  const parts = [`"n", COUNTROWS(${daxTable(table)})`, ...dates.map((c, i) => `"d${i}", MAX(${daxColumn(table, c)})`)];
  const query = `EVALUATE ROW(${parts.join(', ')})`;
  try {
    if (ctx.model.rls) {
      return (await executeDaxQueries(ctx.model.workspaceId, ctx.model.datasetId, query, { rowLimit: 1 }))[0]?.rows?.[0] ?? null;
    }
    const res = await executeDatasetQueries(ctx.model.workspaceId, ctx.model.datasetId, [query]);
    return (res.results?.[0]?.tables?.[0]?.rows?.[0] as Record<string, unknown> | undefined) ?? null;
  } catch {
    return null;
  }
}

async function warehouseAggregate(orgId: string, dax: string, ctx: SliceContext): Promise<unknown> {
  if (!ctx.connectionId) return null;
  const c = compileMeasureToSql({ measureDax: dax, catalog: ctx.catalog });
  if (!c.ok) return null;
  const run = await runPbiSql({
    orgId,
    connectionId: ctx.connectionId,
    sql: c.sql,
    mode: 'execute',
    purpose: 'pbi_freshness_probe',
    budgetMs: PROBE_BUDGET_MS,
    maxAttempts: 1,
    useCache: false,
  });
  return run.status === 'ok' ? extractSqlValue(run.rows).raw : null;
}

const pick = (row: Record<string, unknown> | null, k: string) => (row ? (row[`[${k}]`] ?? row[k] ?? null) : null);

/** Drift of one table (dataset vs warehouse). */
export async function probeTableDrift(orgId: string, table: string, ctx: SliceContext): Promise<TableDrift> {
  const dates = dateColumns(table, ctx);
  // Row counts first: a count difference is evidence enough; date checks only when counts agree.
  const [pbi, wRows] = await Promise.all([
    powerBiAggregates(table, dates, ctx),
    warehouseAggregate(orgId, `COUNTROWS(${daxTable(table)})`, ctx),
  ]);
  const countsDiffer = pick(pbi, 'n') != null && wRows != null && Number(pick(pbi, 'n')) !== Number(wRows);
  const wDates = countsDiffer
    ? dates.map(() => null)
    : await Promise.all(dates.map((c) => warehouseAggregate(orgId, `MAX(${daxColumn(table, c)})`, ctx)));
  const pbiDates: Record<string, unknown> = {};
  const whDates: Record<string, unknown> = {};
  dates.forEach((c, i) => {
    pbiDates[c] = pick(pbi, `d${i}`);
    whDates[c] = wDates[i] ?? null;
  });
  return tableDrift({ table, powerBi: { rows: pick(pbi, 'n'), maxDates: pbiDates }, warehouse: { rows: wRows, maxDates: whDates } });
}

/** A probe result is reused for this long: sources change during long runs (a view was reloaded
 *  to 0 rows overnight while a 7 h run kept using its 18:19 "no drift" result). */
const PROBE_TTL_MS = Number(process.env.PBI_FRESHNESS_PROBE_TTL_MS ?? 10 * 60_000);

/** Per-run cache: each table of a model is probed at most once per PROBE_TTL_MS. */
export class DriftCache {
  private readonly byTable = new Map<string, { at: number; drift: Promise<TableDrift> }>();
  constructor(
    private readonly orgId: string,
    private readonly ctx: SliceContext,
  ) {}

  forMeasure(measure: string): Promise<TableDrift[]> {
    return Promise.all(
      tablesReadBy(measure, this.ctx).map((t) => {
        const k = tkey(t);
        const hit = this.byTable.get(k);
        if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.drift;
        const drift = probeTableDrift(this.orgId, t, this.ctx);
        this.byTable.set(k, { at: Date.now(), drift });
        return drift;
      }),
    );
  }
}
