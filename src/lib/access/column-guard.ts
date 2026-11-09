/**
 * Column protections in the query path (E8-T5, E10-T1, E11-T2).
 *
 * COLUMN_ACCESS_MODE:
 *   off      (default) nothing runs
 *   shadow   the check runs on every query and records what it WOULD do (timings included);
 *            people get today's results unchanged
 *   enforce  protected columns are masked (•••) in results, filters on them are refused, Totals-only
 *            queries get a minimum group size of 5, and queries the parser cannot read are refused
 *            when a table in them has protected columns (fail closed)
 *
 * Fast path: if no table in the query has a protected column (or a whole-path protection), nothing
 * else runs.
 */
import { prisma } from '@/lib/db';
import type { DatabricksExecuteResult } from '@/lib/databricks/execute';
import { decideColumnUse, pathProtections, type AccessModel, type Person, type Protection } from './engine';
import { getAccessModel } from './model-store';
import { isAccessActive, reportConfigError } from './config';
import { resolveColumns, withMinGroupSize, type ColumnRef } from './sql-columns';
import { friendlyColumnName, MASK, MIN_GROUP_SIZE } from './decide-column';
import type { AccessPrincipal, AccessSurface } from './types';

export type ColumnMode = 'off' | 'shadow' | 'enforce';

/** Unset means off; an unrecognised value (a typo) means enforce, so a mistake never turns masking off. */
export function columnAccessMode(): ColumnMode {
  const raw = (process.env.COLUMN_ACCESS_MODE ?? 'off').trim().toLowerCase();
  if (raw === 'off' || raw === 'shadow' || raw === 'enforce') return raw;
  reportConfigError('COLUMN_ACCESS_MODE', `COLUMN_ACCESS_MODE value "${raw}" is not recognised (use off, shadow or enforce); enforcing.`);
  return 'enforce';
}

/**
 * True when a query must run as a real person: table checks are on, or protected columns are masked.
 * Callers must not fall back to a system principal then, because the column guard skips system
 * principals and protected columns would come back unmasked (review H2).
 */
export function viewerPrincipalRequired(): boolean {
  return isAccessActive() || columnAccessMode() !== 'off';
}

/** Shown to the AI and the person (never values). */
export interface AccessNote {
  masked: { column: string; friendly: string; protections: string[] }[];
  refused?: { column: string; friendly: string; protections: string[] }[];
  totalsOnly?: boolean;
  message: string;
  /** Prefilled request link for the first missing protection. */
  request: string | null;
}

export interface ColumnPlan {
  applies: boolean;
  mode: ColumnMode;
  parserOk: boolean;
  /** Statement to run (with a minimum group size added for Totals-only access). */
  statement: string;
  /** Result positions to mask, with the names they are expected to have. */
  maskIndexes: { index: number; name: string | null }[];
  refused: { column: string; friendly: string; protections: Protection[] }[];
  masked: { column: string; friendly: string; protections: Protection[] }[];
  totalsOnly: boolean;
  note: AccessNote | null;
  /** Why the query must stop (enforce), or would stop (shadow). */
  stop: string | null;
  timings: { model_ms: number; columns_ms: number; resolve_ms: number; decide_ms: number; total_ms: number };
}

const now = () => performance.now();

/** Tables (of these) that carry any column protection or whole-path protection. */
function protectedTables(model: AccessModel, tables: string[]): string[] {
  return tables.filter((t) => pathProtections(model, t).length > 0 || model.targets.some((x) => x.column !== null && x.path === t));
}

async function columnLists(model: AccessModel, tables: string[], orgId: string): Promise<Map<string, string[]>> {
  const objects = await prisma.platformContextObject.findMany({
    where: { org_id: orgId, full_path: { in: tables } },
    select: { id: true, full_path: true },
  });
  const cols = objects.length
    ? await prisma.platformContextColumn.findMany({
        where: { object_id: { in: objects.map((o) => o.id) } },
        select: { object_id: true, name: true, ordinal: true },
        orderBy: { ordinal: 'asc' },
      })
    : [];
  const pathById = new Map(objects.map((o) => [o.id, o.full_path.toLowerCase()]));
  const map = new Map<string, string[]>();
  for (const c of cols) {
    const p = pathById.get(c.object_id);
    if (!p) continue;
    map.set(p, [...(map.get(p) ?? []), c.name.toLowerCase()]);
  }
  // Protected column names are always known, even when the harvest has not seen the table.
  for (const t of model.targets) {
    if (t.column && tables.includes(t.path) && !(map.get(t.path) ?? []).includes(t.column)) {
      map.set(t.path, [...(map.get(t.path) ?? []), t.column]);
    }
  }
  return map;
}

function noteFor(masked: ColumnPlan['masked'], refused: ColumnPlan['refused'], totalsOnly: boolean): AccessNote | null {
  if (!masked.length && !refused.length && !totalsOnly) return null;
  const names = (xs: { protections: Protection[] }[]) => [...new Set(xs.flatMap((x) => x.protections.map((p) => p.name)))].join(', ');
  const firstTag = [...refused, ...masked].flatMap((x) => x.protections)[0];
  let message: string;
  if (refused.length) {
    message = `You can't filter, sort, group or join by ${[...new Set(refused.map((r) => r.friendly))].join(', ')} because you don't have access to ${names(refused)} data. If you need it, request access.`;
  } else if (masked.length) {
    const cols = [...new Set(masked.map((m) => m.friendly))].join(', ');
    message = `${cols} ${masked.length === 1 ? 'is' : 'are'} hidden: you don't have access to ${names(masked)} data. If you need it, request access.`;
  } else {
    message = `Totals only: groups smaller than ${MIN_GROUP_SIZE} people are left out.`;
  }
  return {
    masked: masked.map((m) => ({ column: m.column, friendly: m.friendly, protections: m.protections.map((p) => p.name) })),
    refused: refused.length ? refused.map((m) => ({ column: m.column, friendly: m.friendly, protections: m.protections.map((p) => p.name) })) : undefined,
    totalsOnly: totalsOnly || undefined,
    message,
    request: firstTag ? `/my-access?tag=${encodeURIComponent(firstTag.id)}` : null,
  };
}

export async function planColumnGuard(principal: AccessPrincipal, statement: string, tables: string[]): Promise<ColumnPlan> {
  const t0 = now();
  const mode = columnAccessMode();
  const base: ColumnPlan = {
    applies: false,
    mode,
    parserOk: true,
    statement,
    maskIndexes: [],
    refused: [],
    masked: [],
    totalsOnly: false,
    note: null,
    stop: null,
    timings: { model_ms: 0, columns_ms: 0, resolve_ms: 0, decide_ms: 0, total_ms: 0 },
  };
  if (mode === 'off' || principal.kind !== 'user' || tables.length === 0) return base;

  const { model } = await getAccessModel(principal.orgId);
  const t1 = now();
  const guarded = protectedTables(model, tables.map((t) => t.toLowerCase()));
  if (guarded.length === 0) {
    base.timings = { model_ms: t1 - t0, columns_ms: 0, resolve_ms: 0, decide_ms: 0, total_ms: now() - t0 };
    return base;
  }

  const columnsByTable = await columnLists(model, tables.map((t) => t.toLowerCase()), principal.orgId);
  const t2 = now();
  const resolved = resolveColumns(statement, columnsByTable);
  const t3 = now();
  const plan: ColumnPlan = { ...base, applies: true };
  if (!resolved.ok) {
    plan.parserOk = false;
    plan.stop = `This query reads protected data and couldn't be checked column by column (${resolved.reason}). Name the columns you need and avoid sub-queries.`;
    plan.timings = { model_ms: t1 - t0, columns_ms: t2 - t1, resolve_ms: t3 - t2, decide_ms: 0, total_ms: now() - t0 };
    return plan;
  }

  const person: Person = { userId: principal.userId, roles: principal.roles ?? [] };
  const outcome = new Map<string, ReturnType<typeof decideColumnUse>>();
  const decide = (r: ColumnRef) => {
    const key = `${r.table}.${r.column}.${r.use}`;
    if (!outcome.has(key)) outcome.set(key, decideColumnUse(model, person, r.table, r.column, r.use));
    return outcome.get(key)!;
  };

  for (const r of resolved.refs) {
    const d = decide(r);
    if (d.outcome === 'refused') plan.refused.push({ column: `${r.table}.${r.column}`, friendly: friendlyColumnName(r.column), protections: d.missing });
    if (d.outcome === 'aggregate') plan.totalsOnly = true;
  }
  resolved.outputs.forEach((o, index) => {
    const missing: Protection[] = [];
    let mask = false;
    for (const src of o.sources) {
      const d = decide({ ...src, use: o.aggregate ? 'aggregate' : 'output' });
      if (d.outcome === 'masked') {
        mask = true;
        missing.push(...d.missing);
      }
    }
    if (mask) {
      plan.maskIndexes.push({ index, name: o.name });
      for (const src of o.sources) plan.masked.push({ column: `${src.table}.${src.column}`, friendly: friendlyColumnName(o.name ?? src.column), protections: missing });
    }
  });
  plan.refused = uniqueBy(plan.refused, (x) => x.column);
  plan.masked = uniqueBy(plan.masked, (x) => x.column);
  if (plan.refused.length) plan.stop = noteFor([], plan.refused, false)!.message;
  if (plan.totalsOnly && !plan.stop) plan.statement = withMinGroupSize(statement, resolved.clauses, MIN_GROUP_SIZE);
  plan.note = noteFor(plan.masked, plan.refused, plan.totalsOnly);
  const t4 = now();
  plan.timings = { model_ms: t1 - t0, columns_ms: t2 - t1, resolve_ms: t3 - t2, decide_ms: t4 - t3, total_ms: t4 - t0 };
  return plan;
}

function uniqueBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

/**
 * Replace protected values with the mask. Positions come from the parser; when the result's shape
 * differs from what was predicted, columns are matched by name instead, and anything unmatched that
 * should be masked makes the whole result masked for those names (never leak by mistake).
 */
export function applyMask(result: DatabricksExecuteResult, plan: ColumnPlan): DatabricksExecuteResult & { access_note?: AccessNote } {
  if (!plan.maskIndexes.length) return plan.note ? { ...result, access_note: plan.note } : result;
  const names = new Set<string>();
  for (const m of plan.maskIndexes) {
    const atIndex = result.columns[m.index]?.name;
    if (atIndex !== undefined && (m.name === null || atIndex.toLowerCase() === m.name)) {
      names.add(atIndex); // shape as predicted
      continue;
    }
    const byName = m.name ? result.columns.filter((c) => c.name.toLowerCase() === m.name).map((c) => c.name) : [];
    if (byName.length) byName.forEach((n) => names.add(n));
    else if (atIndex !== undefined) names.add(atIndex); // shape differs, no name match: mask the position
  }
  const rows = result.rows.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    for (const n of names) if (n in copy) copy[n] = MASK;
    return copy;
  });
  return { ...result, rows, access_note: plan.note ?? undefined };
}

/** Record what the column check did (enforce) or would do (shadow). Never blocks the query. */
export function logColumnDecision(principal: AccessPrincipal, surface: AccessSurface, tables: string[], plan: ColumnPlan, sessionId?: string | null): void {
  if (!plan.applies || principal.kind !== 'user') return;
  const decision = plan.stop ? 'deny' : 'allow';
  const reason = !plan.parserOk ? 'column_unresolved' : plan.refused.length ? 'column_refused' : plan.masked.length ? 'column_masked' : plan.totalsOnly ? 'column_totals_only' : 'column_ok';
  void prisma.accessDecisionLog
    .create({
      data: {
        org_id: principal.orgId,
        user_id: principal.userId,
        surface,
        level: 'query',
        paths: tables,
        decision,
        reason,
        mode: plan.mode,
        session_id: sessionId ?? null,
        column_mode: plan.mode,
        masked_columns: plan.masked.map((m) => m.column),
        refused_columns: plan.refused.map((m) => m.column),
        parser_ok: plan.parserOk,
        timings: plan.timings,
      },
    })
    .catch(() => {});
}
