import { describe, expect, it } from 'vitest';
import {
  budgetHealth,
  budgetView,
  buildBudgetScope,
  fmtTokens,
  fmtUsd,
  fmtUsdCompact,
  parseBudgetScope,
  pctChange,
  periodWindow,
  projectPeriodSpend,
  trailingAverage,
} from '../cost-derive';

describe('fmtUsd', () => {
  it('scales precision with magnitude', () => {
    expect(fmtUsd(0)).toBe('$0');
    expect(fmtUsd(1234.56)).toBe('$1,235');
    expect(fmtUsd(12.5)).toBe('$12.50');
    expect(fmtUsd(0.25)).toBe('$0.25');
    expect(fmtUsd(0.0042)).toBe('$0.0042');
  });
  it('compacts for axes', () => {
    expect(fmtUsdCompact(1500)).toBe('$1.5k');
    expect(fmtUsdCompact(42)).toBe('$42');
    expect(fmtUsdCompact(0.5)).toBe('$0.5');
    expect(fmtUsdCompact(2_000_000)).toBe('$2M');
  });
  it('formats tokens', () => {
    expect(fmtTokens(950)).toBe('950');
    expect(fmtTokens(12_300)).toBe('12.3k');
    expect(fmtTokens(4_000_000)).toBe('4M');
  });
});

describe('pctChange', () => {
  it('returns null without a baseline', () => {
    expect(pctChange(10, 0)).toBeNull();
  });
  it('returns the fractional change', () => {
    expect(pctChange(15, 10)).toBeCloseTo(0.5);
    expect(pctChange(5, 10)).toBeCloseTo(-0.5);
  });
});

describe('periodWindow / projectPeriodSpend', () => {
  it('uses UTC month boundaries', () => {
    const now = new Date(Date.UTC(2026, 10, 16, 0, 0, 0)); // 16 Nov, 15 of 30 days elapsed
    const w = periodWindow('monthly', now);
    expect(w.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(w.elapsed).toBeCloseTo(0.5);
    expect(projectPeriodSpend(100, 'monthly', now)).toBeCloseTo(200);
  });
  it('declines to project very early in the period', () => {
    const now = new Date(Date.UTC(2026, 10, 1, 6));
    expect(projectPeriodSpend(40, 'monthly', now)).toBeNull();
  });
  it('handles daily periods', () => {
    const now = new Date(Date.UTC(2026, 10, 5, 18));
    expect(projectPeriodSpend(3, 'daily', now)).toBeCloseTo(4);
  });
});

describe('trailingAverage', () => {
  it('averages the tail', () => {
    expect(trailingAverage([100, 1, 2, 3], 3)).toBe(2);
    expect(trailingAverage([], 7)).toBe(0);
  });
});

describe('budget scopes', () => {
  it('parses each scope kind', () => {
    expect(parseBudgetScope('org:abc:harvest')).toEqual({ kind: 'org', subject: 'abc', bucket: 'harvest' });
    expect(parseBudgetScope('role:member:interactive')).toEqual({ kind: 'role', subject: 'member', bucket: 'interactive' });
    expect(parseBudgetScope('user:u-1:interactive')).toEqual({ kind: 'user', subject: 'u-1', bucket: 'interactive' });
    expect(parseBudgetScope('global').kind).toBe('other');
  });
  it('builds interactive scopes that round-trip', () => {
    const s = buildBudgetScope('user', 'u-9');
    expect(s).toBe('user:u-9:interactive');
    expect(parseBudgetScope(s).subject).toBe('u-9');
  });
});

describe('budgetHealth', () => {
  const base = { amountUsd: 100, alertPct: 80, projectedUsd: null };
  it('ranks states', () => {
    expect(budgetHealth({ ...base, spentUsd: 120 })).toBe('exceeded');
    expect(budgetHealth({ ...base, spentUsd: 85 })).toBe('alert');
    expect(budgetHealth({ ...base, spentUsd: 40, projectedUsd: 130 })).toBe('trending-over');
    expect(budgetHealth({ ...base, spentUsd: 40, projectedUsd: 90 })).toBe('ok');
  });
  it('does not track role caps or zero caps', () => {
    expect(budgetHealth({ ...base, spentUsd: 0, perUser: true })).toBe('not-tracked');
    expect(budgetHealth({ ...base, amountUsd: 0, spentUsd: 5 })).toBe('not-tracked');
  });
});

describe('budgetView', () => {
  const now = new Date(Date.UTC(2026, 10, 16)); // half-way through November
  const role = { scope: 'role:member:interactive', amountUsd: 75, alertPct: 80, period: 'monthly' as const };
  const group = { totalUsd: 200, people: 4, topUserId: 'u1', topUserUsd: 80, overCount: 1, alertCount: 1 };

  it('reports a role cap as the combined total, with health from the people it governs', () => {
    const v = budgetView(role, { spentUsd: 200, group }, now);
    expect(v.kind).toBe('role');
    expect(v.spentUsd).toBe(200);
    expect(v.health).toBe('exceeded');
    expect(v.pctUsed).toBeCloseTo((80 / 75) * 100);
    expect(budgetView(role, { spentUsd: 120, group: { ...group, overCount: 0, topUserUsd: 65 } }, now).health).toBe('alert');
    expect(budgetView(role, { spentUsd: 30, group: { ...group, overCount: 0, alertCount: 0, topUserUsd: 20 } }, now).health).toBe('ok');
  });

  it('treats a role cap without a breakdown, or with no cap amount, as not tracked', () => {
    expect(budgetView(role, { spentUsd: 0 }, now).health).toBe('not-tracked');
    expect(budgetView({ ...role, amountUsd: 0 }, { spentUsd: 10, group }, now).health).toBe('not-tracked');
  });

  it('keeps org caps on spend vs cap with a projection', () => {
    const v = budgetView({ scope: 'org:o1:interactive', amountUsd: 100, alertPct: 80, period: 'monthly' }, { spentUsd: 60 }, now);
    expect(v.group).toBeNull();
    expect(v.pctUsed).toBe(60);
    expect(v.health).toBe('trending-over');
  });
});

describe('combined role caps', () => {
  const now = new Date(Date.UTC(2026, 10, 16));
  it('parses and builds the role-total scope', () => {
    expect(parseBudgetScope('role-total:member:interactive')).toEqual({ kind: 'role-total', subject: 'member', bucket: 'interactive' });
    expect(buildBudgetScope('role-total', 'admin')).toBe('role-total:admin:interactive');
  });
  it('tracks the combined total against the cap and keeps the breakdown', () => {
    const group = { totalUsd: 900, people: 12, topUserId: 'u1', topUserUsd: 140, overCount: 0, alertCount: 0 };
    const v = budgetView({ scope: 'role-total:member:interactive', amountUsd: 1000, alertPct: 80, period: 'monthly' }, { spentUsd: 900, group }, now);
    expect(v.kind).toBe('role-total');
    expect(v.pctUsed).toBe(90);
    expect(v.health).toBe('alert');
    expect(v.group).toEqual(group);
  });
});

