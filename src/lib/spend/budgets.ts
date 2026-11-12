import 'server-only';

import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import { DEFAULT_ROLE, resolvePrimaryRole } from '@/lib/rbac';
import type { RoleCapGroup } from '@/lib/spend/cost-types';

export type BudgetBucket = 'interactive' | 'harvest';
export type BudgetMode = 'soft' | 'hard';
export type BudgetPeriod = 'monthly' | 'daily';

export interface BudgetPolicyRow {
  id: string;
  scope: string;
  orgId: string | null;
  amountUsd: number;
  period: BudgetPeriod;
  mode: BudgetMode;
  alertPct: number;
  alertEmail: string | null;
}

export interface BudgetStatusRow {
  scope: string;
  label: string;
  amountUsd: number;
  spentUsd: number;
  period: BudgetPeriod;
  mode: BudgetMode;
  alertPct: number;
  pctUsed: number;
  alert: boolean;
  exceeded: boolean;
  /** Role caps only: combined total and per-person breakdown. See `RoleCapGroup`. */
  group?: RoleCapGroup;
}

export class BudgetExceededError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(402, message, { code: 'BUDGET_EXCEEDED', ...details });
    this.name = 'BudgetExceededError';
  }
}

function periodStart(period: BudgetPeriod): Date {
  const now = new Date();
  if (period === 'daily') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function scopeLabel(scope: string): string {
  if (scope.endsWith(':interactive')) {
    if (scope.startsWith('org:')) return 'Org — interactive AI';
    if (scope.startsWith('user:')) return 'User override — interactive';
    if (scope.startsWith('role:')) return `Role ${scope.split(':')[1]} — interactive`;
    if (scope.startsWith('role-total:')) return `Role ${scope.split(':')[1]} — combined interactive`;
  }
  if (scope.endsWith(':harvest')) return 'Org — harvest / platform jobs';
  return scope;
}

export async function sumSpendUsd(opts: {
  orgId: string;
  bucket: BudgetBucket;
  since: Date;
  userId?: string | null;
}): Promise<number> {
  const rows = await prisma.platformSpendEvent.aggregate({
    where: {
      org_id: opts.orgId,
      bucket: opts.bucket,
      occurred_at: { gte: opts.since },
      ...(opts.userId ? { user_id: opts.userId } : {}),
    },
    _sum: { usd: true },
  });
  return Number(rows._sum.usd ?? 0);
}

export async function listBudgetPolicies(orgId: string): Promise<BudgetPolicyRow[]> {
  const rows = await prisma.budget_config.findMany({
    where: { OR: [{ org_id: orgId }, { org_id: null, scope: { startsWith: 'role:' } }] },
    orderBy: { scope: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope ?? 'global',
    orgId: r.org_id,
    amountUsd: Number(r.budget_amount ?? 0),
    period: (r.period as BudgetPeriod) ?? 'monthly',
    mode: (r.mode as BudgetMode) ?? 'soft',
    alertPct: r.alert_pct ?? 80,
    alertEmail: r.alert_email,
  }));
}

/** Create sensible defaults when an org has no budget rows yet. */
export async function ensureDefaultBudgetPolicies(orgId: string): Promise<void> {
  const n = await prisma.budget_config.count({ where: { org_id: orgId } });
  if (n > 0) return;
  await prisma.budget_config.createMany({
    data: [
      {
        org_id: orgId,
        scope: `org:${orgId}:interactive`,
        budget_amount: 500,
        period: 'monthly',
        mode: 'soft',
        alert_pct: 80,
      },
      {
        org_id: orgId,
        scope: `org:${orgId}:harvest`,
        budget_amount: 2500,
        period: 'monthly',
        mode: 'soft',
        alert_pct: 80,
      },
      {
        org_id: null,
        scope: 'role:member:interactive',
        budget_amount: 75,
        period: 'monthly',
        mode: 'soft',
        alert_pct: 80,
      },
    ],
  });
}

type PersonSpend = { userId: string; usd: number; overridden: boolean };

/** Personal interactive overrides (`user:<id>:interactive`) in the policy list. */
function overriddenUserIds(policies: BudgetPolicyRow[]): Set<string> {
  return new Set(
    policies
      .filter((p) => p.scope.startsWith('user:') && p.scope.endsWith(':interactive'))
      .map((p) => p.scope.split(':')[1])
      .filter((id): id is string => !!id),
  );
}

/**
 * Interactive spend per person this period, keyed by primary role (same rule as the session
 * role), largest first. `overridden` marks people with a personal cap: per-person role caps
 * skip them, combined role caps (`role-total:`) count them, since they still hold the role.
 */
async function interactiveSpendByRole(
  orgId: string,
  period: BudgetPeriod,
  overridden: Set<string>,
): Promise<Map<string, PersonSpend[]>> {
  const rows = await prisma.platformSpendEvent.groupBy({
    by: ['user_id'],
    where: { org_id: orgId, bucket: 'interactive', occurred_at: { gte: periodStart(period) }, user_id: { not: null } },
    _sum: { usd: true },
  });
  const spend = rows
    .map((r) => ({ userId: r.user_id as string, usd: Number(r._sum.usd ?? 0), overridden: overridden.has(r.user_id as string) }))
    .filter((r) => r.usd > 0);
  if (!spend.length) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: spend.map((s) => s.userId) } },
    select: { id: true, roles: { select: { role: { select: { name: true } } } } },
  });
  const roleOf = new Map(users.map((u) => [u.id, resolvePrimaryRole(u)]));
  const byRole = new Map<string, PersonSpend[]>();
  for (const s of spend) {
    // Spend from a user id that no longer exists gets the same default role a session would.
    const role = roleOf.get(s.userId) ?? DEFAULT_ROLE;
    const list = byRole.get(role) ?? [];
    list.push(s);
    byRole.set(role, list);
  }
  for (const list of byRole.values()) list.sort((a, b) => b.usd - a.usd);
  return byRole;
}

function roleCapGroup(people: { userId: string; usd: number }[], amountUsd: number, alertPct: number): RoleCapGroup {
  const over = amountUsd > 0 ? people.filter((p) => p.usd >= amountUsd).length : 0;
  const alerting = amountUsd > 0 ? people.filter((p) => p.usd < amountUsd && (p.usd / amountUsd) * 100 >= alertPct).length : 0;
  return {
    totalUsd: people.reduce((s, p) => s + p.usd, 0),
    people: people.length,
    topUserId: people[0]?.userId ?? null,
    topUserUsd: people[0]?.usd ?? 0,
    overCount: over,
    alertCount: alerting,
  };
}

export async function getBudgetStatuses(orgId: string): Promise<BudgetStatusRow[]> {
  await ensureDefaultBudgetPolicies(orgId);
  const policies = await listBudgetPolicies(orgId);
  const out: BudgetStatusRow[] = [];

  const overridden = overriddenUserIds(policies);
  const roleSpend = new Map<BudgetPeriod, Promise<Map<string, PersonSpend[]>>>();
  const roleSpendFor = (period: BudgetPeriod) => {
    let p = roleSpend.get(period);
    if (!p) {
      p = interactiveSpendByRole(orgId, period, overridden);
      roleSpend.set(period, p);
    }
    return p;
  };

  for (const p of policies) {
    if (p.scope.startsWith('role-total:') && p.scope.endsWith(':interactive')) {
      // One cap on everyone with the role together, overrides included.
      const role = p.scope.split(':')[1] ?? '';
      const group = roleCapGroup((await roleSpendFor(p.period)).get(role) ?? [], 0, p.alertPct);
      const pctUsed = p.amountUsd > 0 ? (group.totalUsd / p.amountUsd) * 100 : 0;
      out.push({
        scope: p.scope,
        label: scopeLabel(p.scope),
        amountUsd: p.amountUsd,
        spentUsd: group.totalUsd,
        period: p.period,
        mode: p.mode,
        alertPct: p.alertPct,
        pctUsed,
        alert: pctUsed >= p.alertPct,
        exceeded: p.amountUsd > 0 && group.totalUsd >= p.amountUsd,
        group,
      });
      continue;
    }
    if (p.scope.startsWith('role:') && p.scope.endsWith(':interactive')) {
      const role = p.scope.split(':')[1] ?? '';
      const governed = ((await roleSpendFor(p.period)).get(role) ?? []).filter((s) => !s.overridden);
      const group = roleCapGroup(governed, p.amountUsd, p.alertPct);
      const pctUsed = p.amountUsd > 0 ? (group.topUserUsd / p.amountUsd) * 100 : 0;
      out.push({
        scope: p.scope,
        label: scopeLabel(p.scope),
        amountUsd: p.amountUsd,
        spentUsd: group.totalUsd,
        period: p.period,
        mode: p.mode,
        alertPct: p.alertPct,
        pctUsed,
        alert: group.overCount + group.alertCount > 0,
        exceeded: group.overCount > 0,
        group,
      });
      continue;
    }

    let userId: string | null = null;
    if (p.scope.startsWith('user:')) {
      userId = p.scope.split(':')[1] ?? null;
    }
    const spentUsd = await spentForPolicy(orgId, p, userId);
    const amountUsd = p.amountUsd;
    const pctUsed = amountUsd > 0 ? (spentUsd / amountUsd) * 100 : 0;
    out.push({
      scope: p.scope,
      label: scopeLabel(p.scope),
      amountUsd,
      spentUsd,
      period: p.period,
      mode: p.mode,
      alertPct: p.alertPct,
      pctUsed,
      alert: pctUsed >= p.alertPct,
      exceeded: spentUsd >= amountUsd && amountUsd > 0,
    });
  }
  return out;
}

function pickUserInteractivePolicy(
  policies: BudgetPolicyRow[],
  orgId: string,
  userId: string | null,
  role: string | null,
): BudgetPolicyRow | null {
  if (userId) {
    const u = policies.find((p) => p.scope === `user:${userId}:interactive`);
    if (u) return u;
  }
  if (role) {
    const r = policies.find((p) => p.scope === `role:${role}:interactive`);
    if (r) return r;
  }
  return policies.find((p) => p.scope === `org:${orgId}:interactive`) ?? null;
}

async function spentForPolicy(
  orgId: string,
  policy: BudgetPolicyRow,
  actingUserId: string | null,
): Promise<number> {
  const since = periodStart(policy.period);
  const bucket: BudgetBucket = policy.scope.includes(':harvest') ? 'harvest' : 'interactive';
  if (policy.scope.startsWith('user:')) {
    const uid = policy.scope.split(':')[1];
    if (uid) return sumSpendUsd({ orgId, bucket, since, userId: uid });
  }
  if (policy.scope.startsWith('role:')) {
    if (actingUserId) {
      return sumSpendUsd({ orgId, bucket, since, userId: actingUserId });
    }
    return 0;
  }
  if (policy.scope.startsWith('org:')) {
    return sumSpendUsd({ orgId, bucket, since });
  }
  return sumSpendUsd({ orgId, bucket, since });
}

/**
 * Throws BudgetExceededError when a hard budget would be exceeded (including estimate).
 * Soft budgets never block.
 */
export async function assertInteractiveBudget(opts: {
  orgId: string;
  userId: string | null;
  role: string | null;
  estimatedUsd?: number;
}): Promise<void> {
  await ensureDefaultBudgetPolicies(opts.orgId);
  const policies = await listBudgetPolicies(opts.orgId);
  const estimate = opts.estimatedUsd ?? 0.05;
  const policy = pickUserInteractivePolicy(policies, opts.orgId, opts.userId, opts.role);
  if (policy && policy.mode === 'hard' && policy.amountUsd > 0) {
    const spentUsd = await spentForPolicy(opts.orgId, policy, opts.userId);
    if (spentUsd + estimate > policy.amountUsd) {
      throw new BudgetExceededError(
        `Interactive AI budget exceeded (${scopeLabel(policy.scope)}: ${spentUsd.toFixed(2)} / ${policy.amountUsd.toFixed(2)} USD this ${policy.period}).`,
        { scope: policy.scope, spentUsd, limitUsd: policy.amountUsd },
      );
    }
  }

  // Combined role cap: shared by everyone with the role, personal overrides included.
  const pool = opts.role ? policies.find((p) => p.scope === `role-total:${opts.role}:interactive`) : undefined;
  if (pool && pool.mode === 'hard' && pool.amountUsd > 0) {
    const byRole = await interactiveSpendByRole(opts.orgId, pool.period, overriddenUserIds(policies));
    const spentUsd = (byRole.get(opts.role!) ?? []).reduce((s, p) => s + p.usd, 0);
    if (spentUsd + estimate > pool.amountUsd) {
      throw new BudgetExceededError(
        `Interactive AI budget exceeded (${scopeLabel(pool.scope)}: ${spentUsd.toFixed(2)} / ${pool.amountUsd.toFixed(2)} USD this ${pool.period}).`,
        { scope: pool.scope, spentUsd, limitUsd: pool.amountUsd },
      );
    }
  }
}

export async function assertHarvestBudget(opts: {
  orgId: string;
  estimatedUsd: number;
}): Promise<void> {
  await ensureDefaultBudgetPolicies(opts.orgId);
  const policies = await listBudgetPolicies(opts.orgId);
  const policy = policies.find((p) => p.scope === `org:${opts.orgId}:harvest`);
  if (!policy || policy.mode !== 'hard' || policy.amountUsd <= 0) return;

  const since = periodStart(policy.period);
  const spentUsd = await sumSpendUsd({ orgId: opts.orgId, bucket: 'harvest', since });
  if (spentUsd + opts.estimatedUsd > policy.amountUsd) {
    throw new BudgetExceededError(
      `Harvest platform budget exceeded (${spentUsd.toFixed(2)} / ${policy.amountUsd.toFixed(2)} USD this ${policy.period}).`,
      { scope: policy.scope, spentUsd, limitUsd: policy.amountUsd },
    );
  }
}

export async function upsertBudgetPolicy(input: {
  id?: string;
  orgId: string;
  scope: string;
  amountUsd: number;
  period: BudgetPeriod;
  mode: BudgetMode;
  alertPct: number;
  alertEmail?: string | null;
}): Promise<BudgetPolicyRow> {
  const data = {
    org_id: input.orgId,
    scope: input.scope,
    budget_amount: input.amountUsd,
    period: input.period,
    mode: input.mode,
    alert_pct: input.alertPct,
    alert_email: input.alertEmail ?? null,
    updated_at: new Date(),
  };
  const row = input.id
    ? await prisma.budget_config.update({ where: { id: input.id }, data })
    : await prisma.budget_config.create({ data });
  return {
    id: row.id,
    scope: row.scope ?? input.scope,
    orgId: row.org_id,
    amountUsd: Number(row.budget_amount ?? 0),
    period: (row.period as BudgetPeriod) ?? 'monthly',
    mode: (row.mode as BudgetMode) ?? 'soft',
    alertPct: row.alert_pct ?? 80,
    alertEmail: row.alert_email,
  };
}
