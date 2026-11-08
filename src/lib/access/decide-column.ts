/**
 * Column access by data tag and access group (docs/access/pii-protection-backlog.md §7.2).
 *
 * Pure functions: no database, no I/O. The caller has already passed the table check
 * (`decide()` in decide.ts) for every table in the query. Column access never opens a table.
 *
 * Rule for one column:
 *   1. No confirmed tag on the column            → full
 *   2. The user holds a non-expired grant (directly, or through a non-expired membership of an
 *      active group) for EVERY tag on the column. Their level is the lowest across those tags.
 *   3. full      → full for every use
 *      aggregate → aggregate for aggregate use (the caller enforces group size ≥ 5),
 *                  masked for output, refused for filter
 *      none      → masked for output and aggregate, refused for filter
 *
 * "filter" covers every non-output use: WHERE, HAVING, JOIN ON, GROUP BY, ORDER BY, window,
 * QUALIFY, and CASE inside a predicate. Each of these can reveal the value without showing it.
 */
import type { AccessPrincipal, ColumnPolicy, PolicySnapshot, TagGrantLevel, TagInfo } from './types';

/** How a query uses a column. */
export type ColumnUse = 'output' | 'filter' | 'aggregate';

/** What the user gets for that use. */
export type ColumnAccess = 'full' | 'aggregate' | 'masked' | 'refused';

export interface ColumnRef {
  /** Table path, `catalog.schema.table` (any case). */
  table: string;
  column: string;
  use: ColumnUse;
}

export interface ColumnDecision extends ColumnRef {
  access: ColumnAccess;
  /** Tags on the column the user lacks (or holds only at aggregate level). Empty when full. */
  missingTags: TagInfo[];
  /** Friendly column name for messages, e.g. "Salary amount". */
  friendly: string;
}

export interface ColumnPlan {
  decisions: ColumnDecision[];
  /** Output columns whose values must be replaced with the mask. One entry per table.column. */
  masked: ColumnDecision[];
  /** Uses that must stop the query before it runs. */
  refused: ColumnDecision[];
  /** Aggregates allowed only for groups of at least MIN_GROUP_SIZE rows. */
  aggregateOnly: ColumnDecision[];
}

export const MASK = '•••';
export const MIN_GROUP_SIZE = 5;

const LEVEL_RANK: Record<TagGrantLevel | 'none', number> = { none: 0, aggregate: 1, full: 2 };

/** "salary_amount" → "Salary amount". */
export function friendlyColumnName(column: string): string {
  const words = column.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  if (!words) return column;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isActive(expiresAt: Date | null, now: number): boolean {
  return !expiresAt || expiresAt.getTime() > now;
}

/** Tag ids on a column (confirmed, active tags only). */
export function tagsForColumn(columns: ColumnPolicy | undefined, table: string, column: string): string[] {
  if (!columns) return [];
  return columns.columnTags.get(table.toLowerCase())?.get(column.toLowerCase()) ?? [];
}

/** True when any column of the table carries a tag. Lets callers skip column work for most queries. */
export function tableHasTaggedColumns(columns: ColumnPolicy | undefined, table: string): boolean {
  const byColumn = columns?.columnTags.get(table.toLowerCase());
  return !!byColumn && byColumn.size > 0;
}

/** The user's best level on one tag, from direct grants and active group memberships. */
export function userTagLevel(
  columns: ColumnPolicy,
  userId: string,
  tagId: string,
  now: number = Date.now(),
): TagGrantLevel | 'none' {
  const groups = new Set(
    (columns.groupsByUser.get(userId) ?? []).filter((m) => isActive(m.expiresAt, now)).map((m) => m.groupId),
  );
  let best: TagGrantLevel | 'none' = 'none';
  for (const g of columns.tagGrants) {
    if (g.tagId !== tagId || !isActive(g.expiresAt, now)) continue;
    const applies =
      (g.principalType === 'user' && g.principalId === userId) ||
      (g.principalType === 'group' && groups.has(g.principalId));
    if (applies && LEVEL_RANK[g.level] > LEVEL_RANK[best]) best = g.level;
    if (best === 'full') break;
  }
  return best;
}

function accessFor(level: TagGrantLevel | 'none', use: ColumnUse): ColumnAccess {
  if (level === 'full') return 'full';
  if (use === 'filter') return 'refused';
  if (level === 'aggregate' && use === 'aggregate') return 'aggregate';
  return 'masked';
}

/** Decide one column use for one principal. */
export function decideColumn(
  principal: AccessPrincipal,
  snapshot: Pick<PolicySnapshot, 'columns'>,
  ref: ColumnRef,
  now: number = Date.now(),
): ColumnDecision {
  const friendly = friendlyColumnName(ref.column);
  const columns = snapshot.columns;
  const tagIds = tagsForColumn(columns, ref.table, ref.column);

  // Untagged column, or a system principal (harvest, knowledge sync, …): column tags do not apply.
  // System principals never return rows to a person; their own scope rules live elsewhere.
  if (!columns || tagIds.length === 0 || principal.kind !== 'user') {
    return { ...ref, access: 'full', missingTags: [], friendly };
  }

  let lowest: TagGrantLevel | 'none' = 'full';
  const missingTags: TagInfo[] = [];
  for (const tagId of tagIds) {
    const level = userTagLevel(columns, principal.userId, tagId, now);
    if (level !== 'full') {
      const info = columns.tags.get(tagId);
      if (info) missingTags.push(info);
    }
    if (LEVEL_RANK[level] < LEVEL_RANK[lowest]) lowest = level;
  }

  return { ...ref, access: accessFor(lowest, ref.use), missingTags, friendly };
}

/** Decide every column use in a query and group the results for the caller. */
export function decideColumns(
  principal: AccessPrincipal,
  snapshot: Pick<PolicySnapshot, 'columns'>,
  refs: ColumnRef[],
  now: number = Date.now(),
): ColumnPlan {
  const decisions = refs.map((r) => decideColumn(principal, snapshot, r, now));
  const seen = new Set<string>();
  const masked: ColumnDecision[] = [];
  for (const d of decisions) {
    if (d.access !== 'masked') continue;
    const key = `${d.table.toLowerCase()}.${d.column.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    masked.push(d);
  }
  return {
    decisions,
    masked,
    refused: decisions.filter((d) => d.access === 'refused'),
    aggregateOnly: decisions.filter((d) => d.access === 'aggregate'),
  };
}

/**
 * Message for the user and the AI (§7.3a). Names the information in plain words and points to
 * Request access. Never includes a value.
 */
export function columnAccessMessage(plan: Pick<ColumnPlan, 'masked' | 'refused'>): string | null {
  const tagNames = (list: ColumnDecision[]) =>
    [...new Set(list.flatMap((d) => d.missingTags.map((t) => t.name)))].join(', ');

  if (plan.refused.length > 0) {
    const cols = [...new Set(plan.refused.map((d) => d.friendly))].join(', ');
    return `You can't filter, sort, group or join by ${cols} because you don't have access to ${tagNames(plan.refused)} data. If you need it, request access.`;
  }
  if (plan.masked.length > 0) {
    const cols = [...new Set(plan.masked.map((d) => d.friendly))].join(', ');
    const verb = plan.masked.length === 1 ? 'is' : 'are';
    return `${cols} ${verb} hidden: you don't have access to ${tagNames(plan.masked)} data. If you need it, request access.`;
  }
  return null;
}
