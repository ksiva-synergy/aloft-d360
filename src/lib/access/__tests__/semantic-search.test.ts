import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {}, default: {} }));
vi.mock('@/lib/context/embed', () => ({ CURRENT_EMBEDDING_MODEL: 'm', embedQuery: vi.fn() }));

import { relativeCut, RELATIVE_CUTOFF } from '../semantic-search';


describe('relativeCut', () => {
  it('keeps results within 75% of the best score, drops technical names, caps the count', () => {
    const rows = [
      { n: 'id', score: 0.3 },
      { n: 'pay', score: 0.2 },
      { n: 'salary_range_end', score: 0.18 },
      { n: '_fivetran_active', score: 0.17 },
      { n: 'job_total_price', score: 0.14 },
    ];
    const kept = relativeCut(rows, (r) => r.n, 10);
    expect(kept.map((r) => r.n)).toEqual(['pay', 'salary_range_end']);
    expect(0.14).toBeLessThan(0.2 * RELATIVE_CUTOFF);
    expect(relativeCut(rows, (r) => r.n, 1).map((r) => r.n)).toEqual(['pay']);
    expect(relativeCut([], (r: { n: string; score: number }) => r.n, 5)).toEqual([]);
  });
});
