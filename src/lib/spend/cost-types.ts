/**
 * Client-safe shapes for the Cost monitor API (`/api/admin/cost/*`).
 * `cost-queries.ts` (server) produces them; `src/views/agent-staging/cost-monitor.tsx` consumes them.
 */

export type SpendBucket = 'interactive' | 'harvest';
export type SpendEventSort = 'recent' | 'cost';

export interface CostSummaryResponse {
  from: string;
  to: string;
  days: number;
  interactive: {
    totalUsd: number;
    eventCount: number;
    /** Turns whose status is set and is not `success`. */
    failedCount: number;
    bySurface: { surface: string; usd: number; count: number }[];
    byModel: { model: string; usd: number; count: number }[];
    /** Top agents by spend (max 12). Turns without an agent slug are left out. */
    byAgent: { agentSlug: string; usd: number; count: number }[];
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
    /** One entry per 24h slot starting at `from` (rolling, not calendar days). */
    dailyUsd: number[];
  };
  harvest: {
    totalUsd: number;
    eventCount: number;
    llmUsd: number;
    infraUsd: number;
    byKind: { jobKind: string; usd: number; count: number }[];
    dailyUsd: number[];
  };
  /** The same-length window ending at `from`. */
  previous: {
    from: string;
    interactiveUsd: number;
    harvestUsd: number;
    interactiveCount: number;
    harvestCount: number;
  };
  byUser: {
    userId: string;
    email: string | null;
    name: string | null;
    interactiveUsd: number;
    harvestUsd: number;
    interactiveCount: number;
    harvestCount: number;
    lastAt: string;
  }[];
}

export interface SpendEventRow {
  id: string;
  occurredAt: string;
  bucket: string;
  surface: string;
  action: string;
  usd: number;
  userId: string | null;
  userEmail: string | null;
  model: string | null;
  jobKind: string | null;
  agentSlug: string | null;
  sessionId: string | null;
  jobId: string | null;
  status: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  meta: unknown;
}

export interface SpendEventsResponse {
  total: number;
  totalUsd: number;
  events: SpendEventRow[];
}

export type BudgetPeriod = 'monthly' | 'daily';
export type BudgetMode = 'soft' | 'hard';

/**
 * Combined spend for a role cap. The cap is per person, so this totals everyone it
 * currently governs: people whose primary role matches and who have no personal override.
 */
export interface RoleCapGroup {
  /** Interactive spend this period, summed over the people the cap governs. */
  totalUsd: number;
  /** People with spend this period who fall under this cap. */
  people: number;
  topUserId: string | null;
  topUserUsd: number;
  /** People at or over the per-person cap. */
  overCount: number;
  /** People past the alert threshold but under the cap. */
  alertCount: number;
}

/** Mirrors `BudgetStatusRow` in `src/lib/spend/budgets.ts` (server-only). */
export interface BudgetStatus {
  scope: string;
  label: string;
  amountUsd: number;
  /** Role caps: the combined total across the people they govern (see `group`). */
  spentUsd: number;
  period: BudgetPeriod;
  mode: BudgetMode;
  alertPct: number;
  /** Role caps: the highest-spending person's share of the per-person cap. */
  pctUsed: number;
  /** Role caps: true when anyone has passed the alert threshold. */
  alert: boolean;
  /** Role caps: true when anyone has reached the per-person cap. */
  exceeded: boolean;
  /** Present on role caps only. */
  group?: RoleCapGroup;
}

/** Mirrors `BudgetPolicyRow` in `src/lib/spend/budgets.ts` (server-only). */
export interface BudgetPolicy {
  id: string;
  scope: string;
  orgId: string | null;
  amountUsd: number;
  period: BudgetPeriod;
  mode: BudgetMode;
  alertPct: number;
  alertEmail: string | null;
}

export type CostSummaryWithBudgets = CostSummaryResponse & { budgets?: BudgetStatus[] };
