/**
 * Pure helpers for the Cost monitor UI: formatting, period-over-period deltas,
 * run-rate projection and budget-scope parsing. No server imports.
 */
import type { BudgetPeriod, BudgetPolicy, BudgetStatus, RoleCapGroup } from '@/lib/spend/cost-types';

const MS_DAY = 86400000;

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Money for tables and tiles: whole dollars from $1k, cents from $1, up to 4 decimals below that. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const a = Math.abs(n);
  if (a >= 1000) return usd0.format(n);
  if (a >= 1) return usd2.format(n);
  if (a >= 0.01) return `${n < 0 ? '-' : ''}$${a.toFixed(3).replace(/0$/, '')}`;
  return `${n < 0 ? '-' : ''}$${a.toFixed(4)}`;
}

/** Short money for chart axes and dense labels: $0, $0.5, $12, $1.2k, $3.4M. */
export function fmtUsdCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}$${trim(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}$${trim(a / 1e3)}k`;
  if (a >= 10) return `${sign}$${Math.round(a)}`;
  if (a >= 1) return `${sign}$${trim(a)}`;
  return `${sign}$${a.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function trim(v: number): string {
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}k`;
  return String(Math.round(n));
}

export function fmtCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

/** Relative change from `prev` to `cur` as a fraction (0.25 = +25%). Null when there is no baseline. */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev <= 0) return null;
  return (cur - prev) / prev;
}

export function fmtPct(frac: number, digits = 0): string {
  const v = frac * 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

/** The current budget period in UTC, matching `periodStart` in `src/lib/spend/budgets.ts`. */
export function periodWindow(period: BudgetPeriod, now: Date = new Date()): { start: Date; end: Date; elapsed: number } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = period === 'daily' ? new Date(Date.UTC(y, m, now.getUTCDate())) : new Date(Date.UTC(y, m, 1));
  const end = period === 'daily' ? new Date(start.getTime() + MS_DAY) : new Date(Date.UTC(y, m + 1, 1));
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
  return { start, end, elapsed };
}

/**
 * Straight-line projection of period-to-date spend to the end of the period.
 * Null in the first 5% of the period, where one early job would swing the estimate wildly.
 */
export function projectPeriodSpend(spentUsd: number, period: BudgetPeriod, now: Date = new Date()): number | null {
  const { elapsed } = periodWindow(period, now);
  if (elapsed < 0.05) return null;
  return spentUsd / elapsed;
}

/** Mean of the last `n` values (fewer when the series is shorter). */
export function trailingAverage(values: number[], n: number): number {
  const tail = values.slice(-n);
  if (tail.length === 0) return 0;
  return tail.reduce((s, v) => s + v, 0) / tail.length;
}

/** Start of the i-th 24h slot of a summary window (summary `dailyUsd` is rolling from `from`). */
export function slotDate(fromIso: string, i: number): Date {
  return new Date(new Date(fromIso).getTime() + i * MS_DAY);
}

/** `role` is a per-person cap for a role; `role-total` caps everyone with the role together. */
export type ScopeKind = 'org' | 'role' | 'role-total' | 'user' | 'other';

export interface ParsedScope {
  kind: ScopeKind;
  /** org id, role name or user id. */
  subject: string | null;
  bucket: 'interactive' | 'harvest' | null;
}

/** Splits a `budget_config.scope` such as `user:<id>:interactive` or `role:member:interactive`. */
export function parseBudgetScope(scope: string): ParsedScope {
  const parts = scope.split(':');
  const bucket = parts.at(-1) === 'interactive' || parts.at(-1) === 'harvest' ? (parts.at(-1) as 'interactive' | 'harvest') : null;
  const head = parts[0];
  if ((head === 'org' || head === 'role' || head === 'role-total' || head === 'user') && parts.length >= 3) {
    return { kind: head, subject: parts.slice(1, -1).join(':') || null, bucket };
  }
  return { kind: 'other', subject: null, bucket };
}

export function buildBudgetScope(kind: 'role' | 'role-total' | 'user', subject: string): string {
  return `${kind}:${subject}:interactive`;
}

/** Status of a budget against its alert threshold and projection. */
export type BudgetHealth = 'exceeded' | 'alert' | 'trending-over' | 'ok' | 'not-tracked';

export function budgetHealth(input: {
  amountUsd: number;
  spentUsd: number;
  alertPct: number;
  projectedUsd: number | null;
  /** Role caps apply per user; the org-wide status row has no single user to sum for. */
  perUser?: boolean;
}): BudgetHealth {
  if (input.perUser || input.amountUsd <= 0) return 'not-tracked';
  if (input.spentUsd >= input.amountUsd) return 'exceeded';
  if ((input.spentUsd / input.amountUsd) * 100 >= input.alertPct) return 'alert';
  if (input.projectedUsd != null && input.projectedUsd > input.amountUsd) return 'trending-over';
  return 'ok';
}

/** Everything a budget card, meter or banner needs, resolved the same way everywhere. */
export interface BudgetView {
  kind: ScopeKind;
  /** Org, user and combined role caps: spend against the cap. Per-person role caps: combined total of the people it governs. */
  spentUsd: number;
  /** End-of-period pace for `spentUsd`. */
  projectedUsd: number | null;
  health: BudgetHealth;
  /** Share of the cap used. Role caps: the highest-spending person's share. */
  pctUsed: number;
  /** Role caps (`role` and `role-total`) only. Null when the server sent no breakdown. */
  group: RoleCapGroup | null;
}

export function budgetView(
  policy: Pick<BudgetPolicy, 'scope' | 'amountUsd' | 'alertPct' | 'period'>,
  status: Pick<BudgetStatus, 'spentUsd' | 'group'> | undefined,
  now: Date = new Date(),
): BudgetView {
  const kind = parseBudgetScope(policy.scope).kind;
  const spentUsd = status?.spentUsd ?? 0;
  const projectedUsd = projectPeriodSpend(spentUsd, policy.period, now);
  if (kind === 'role') {
    const group = status?.group ?? null;
    const capped = policy.amountUsd > 0;
    const health: BudgetHealth = !group || !capped ? 'not-tracked' : group.overCount > 0 ? 'exceeded' : group.alertCount > 0 ? 'alert' : 'ok';
    return { kind, spentUsd, projectedUsd, health, pctUsed: group && capped ? (group.topUserUsd / policy.amountUsd) * 100 : 0, group };
  }
  return {
    kind,
    spentUsd,
    projectedUsd,
    health: budgetHealth({ amountUsd: policy.amountUsd, spentUsd, alertPct: policy.alertPct, projectedUsd }),
    pctUsed: policy.amountUsd > 0 ? (spentUsd / policy.amountUsd) * 100 : 0,
    // Combined role caps carry the breakdown too (people, highest spender).
    group: kind === 'role-total' ? (status?.group ?? null) : null,
  };
}
