import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    budget_config: { count: vi.fn(), findMany: vi.fn() },
    platformSpendEvent: { aggregate: vi.fn(), groupBy: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';
import { assertInteractiveBudget, BudgetExceededError, getBudgetStatuses } from '@/lib/spend/budgets';

const row = (scope: string, amount: number, org: string | null = 'o1') => ({
  id: scope,
  scope,
  org_id: org,
  budget_amount: amount,
  period: 'monthly',
  mode: 'soft',
  alert_pct: 80,
  alert_email: null,
});
const roles = (...names: string[]) => names.map((name) => ({ role: { name } }));

describe('getBudgetStatuses — role caps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.budget_config.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.budget_config.findMany).mockResolvedValue([
      row('org:o1:interactive', 500),
      row('role:member:interactive', 50, null),
      row('role:admin:interactive', 200, null),
      row('user:u4:interactive', 10),
      row('role-total:member:interactive', 120),
    ] as never);
    vi.mocked(prisma.platformSpendEvent.aggregate).mockResolvedValue({ _sum: { usd: 999 } } as never);
    vi.mocked(prisma.platformSpendEvent.groupBy).mockResolvedValue([
      { user_id: 'u1', _sum: { usd: 60 } }, // member, over the $50 cap
      { user_id: 'u2', _sum: { usd: 45 } }, // member, past 80%
      { user_id: 'u3', _sum: { usd: 30 } }, // admin and member: admin wins
      { user_id: 'u4', _sum: { usd: 25 } }, // member with a personal override: only in the combined cap
      { user_id: 'gone', _sum: { usd: 5 } }, // deleted user: default role
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'u1', roles: roles('member') },
      { id: 'u2', roles: [] },
      { id: 'u3', roles: roles('member', 'admin') },
      { id: 'u4', roles: roles('member') },
    ] as never);
  });

  it('totals the people each role cap governs and flags anyone over or near it', async () => {
    const statuses = await getBudgetStatuses('o1');
    const member = statuses.find((s) => s.scope === 'role:member:interactive')!;
    expect(member.spentUsd).toBe(110); // u1 + u2 + gone
    expect(member.group).toEqual({ totalUsd: 110, people: 3, topUserId: 'u1', topUserUsd: 60, overCount: 1, alertCount: 1 });
    expect(member.exceeded).toBe(true);
    expect(member.alert).toBe(true);
    expect(member.pctUsed).toBeCloseTo(120);

    const admin = statuses.find((s) => s.scope === 'role:admin:interactive')!;
    expect(admin.group).toMatchObject({ totalUsd: 30, people: 1, topUserId: 'u3', overCount: 0, alertCount: 0 });
    expect(admin.exceeded).toBe(false);

    // One grouped query per period, shared across role caps.
    expect(prisma.platformSpendEvent.groupBy).toHaveBeenCalledTimes(1);
    const ids = vi.mocked(prisma.user.findMany).mock.calls[0]![0]!.where!.id as { in: string[] };
    expect(ids.in).toContain('u4'); // looked up for the combined cap, left out of the per-person one

    const org = statuses.find((s) => s.scope === 'org:o1:interactive')!;
    expect(org.spentUsd).toBe(999);
    expect(org.group).toBeUndefined();
  });

  it('reports a combined role cap over everyone with the role, personal overrides included', async () => {
    const statuses = await getBudgetStatuses('o1');
    const pool = statuses.find((s) => s.scope === 'role-total:member:interactive')!;
    expect(pool.spentUsd).toBe(135); // u1 60 + u2 45 + u4 25 + gone 5
    expect(pool.group).toMatchObject({ totalUsd: 135, people: 4, topUserId: 'u1', overCount: 0, alertCount: 0 });
    expect(pool.pctUsed).toBeCloseTo(112.5);
    expect(pool.exceeded).toBe(true);
    expect(pool.label).toBe('Role member — combined interactive');
    // The per-person card still leaves the overridden person out.
    expect(statuses.find((s) => s.scope === 'role:member:interactive')!.spentUsd).toBe(110);
  });

  it('blocks a member once a hard combined cap would be passed, even under their own cap', async () => {
    vi.mocked(prisma.budget_config.findMany).mockResolvedValue([
      row('org:o1:interactive', 500),
      { ...row('role:member:interactive', 1000, null), mode: 'hard' },
      { ...row('role-total:member:interactive', 135), mode: 'hard' },
    ] as never);
    vi.mocked(prisma.platformSpendEvent.aggregate).mockResolvedValue({ _sum: { usd: 45 } } as never);
    await expect(assertInteractiveBudget({ orgId: 'o1', userId: 'u2', role: 'member' })).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(assertInteractiveBudget({ orgId: 'o1', userId: 'u3', role: 'admin' })).resolves.toBeUndefined();
  });

  it('only flags a soft combined cap', async () => {
    vi.mocked(prisma.budget_config.findMany).mockResolvedValue([row('role-total:member:interactive', 10)] as never);
    await expect(assertInteractiveBudget({ orgId: 'o1', userId: 'u2', role: 'member' })).resolves.toBeUndefined();
    expect(prisma.platformSpendEvent.groupBy).not.toHaveBeenCalled();
  });
});
