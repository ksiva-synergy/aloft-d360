import { describe, it, expect, vi } from 'vitest';

// profile.ts imports the Prisma client; computeDrift itself is pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ default: {}, prisma: {} }));

import { computeDrift } from './profile';
import { describeDrift, isSignificantDrift } from './drift-summary';
import { scoreTrusted } from './data-score/dimensions/trusted';

const stats = (rows: number, cols: Record<string, Record<string, unknown>>) => ({ row_count: rows, columns: cols });

describe('isSignificantDrift', () => {
  it('is false for the empty record computeDrift writes on an unchanged re-profile', () => {
    const s = stats(5000, { id: { data_type: 'bigint', null_rate: 0, top_k: [{ value: 1, count: 1 }] } });
    const drift = computeDrift(s, s);
    expect(drift).not.toBeNull();
    expect(isSignificantDrift(drift)).toBe(false);
    expect(describeDrift(drift)).toEqual([]);
  });

  it('is false for null / non-object input', () => {
    expect(isSignificantDrift(null)).toBe(false);
    expect(isSignificantDrift(undefined)).toBe(false);
    expect(isSignificantDrift('x')).toBe(false);
  });

  it('flags schema changes', () => {
    const drift = computeDrift(
      stats(10, { a: { data_type: 'int' } }),
      stats(10, { a: { data_type: 'bigint' }, b: { data_type: 'string' } }),
    );
    expect(isSignificantDrift(drift)).toBe(true);
    const text = describeDrift(drift).map((l) => l.text);
    expect(text).toContain('new_columns (1): b');
    expect(text).toContain('a data_type: int → bigint');
  });

  it('flags a null-rate shift over 10 points', () => {
    const drift = computeDrift(stats(10, { a: { null_rate: 0.02 } }), stats(10, { a: { null_rate: 0.4 } }));
    expect(isSignificantDrift(drift)).toBe(true);
    expect(describeDrift(drift)[0].text).toBe('a null_rate: 2% → 40%');
  });

  it('counts a row change of 10% or more, not smaller moves', () => {
    expect(isSignificantDrift(computeDrift(stats(100, {}), stats(115, {})))).toBe(true);
    expect(isSignificantDrift(computeDrift(stats(100, {}), stats(105, {})))).toBe(false);
  });

  it('reports top-value shifts as informational only', () => {
    const drift = computeDrift(
      stats(10, { a: { top_k: [{ value: 'x', count: 3 }] } }),
      stats(10, { a: { top_k: [{ value: 'y', count: 3 }] } }),
    );
    expect(isSignificantDrift(drift)).toBe(false);
    const lines = describeDrift(drift);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'top_values', significant: false });
  });
});

describe('scoreTrusted drift sub-score', () => {
  const base = {
    freshness: { stale: false },
    latestSemanticCard: { summary: 's' },
    latestSemanticStatus: 'assumed',
  };
  const unchanged = computeDrift(stats(5000, {}), stats(5000, {}));
  const changed = computeDrift(stats(10, { a: {} }), stats(10, { a: {}, b: {} }));

  it('does not penalise re-profiles that found no change', () => {
    const result = scoreTrusted({
      ...base,
      profileHistory: [{ drift: unchanged }, { drift: unchanged }, { drift: unchanged }, { drift: null }],
    } as any);
    // freshness 0.35 + no drift 0.30 + assumed 0.10
    expect(result.score).toBeCloseTo(0.75);
    expect(result.reasons.some((r) => r.includes('changed in'))).toBe(false);
  });

  it('penalises real changes and says how many profiles changed', () => {
    const result = scoreTrusted({
      ...base,
      profileHistory: [{ drift: changed }, { drift: changed }, { drift: unchanged }, { drift: null }],
    } as any);
    // freshness 0.35 + two events 0.20 + assumed 0.10
    expect(result.score).toBeCloseTo(0.65);
    expect(result.reasons).toContain('Schema/data changed in 2 of the last 4 profiles');
  });
});
