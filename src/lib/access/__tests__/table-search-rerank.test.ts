import { describe, expect, it, vi } from 'vitest';
import type { TableSearchHit } from '../table-search-hybrid';
import { applyRerankKeepIndices } from '../search-rerank-parse';
import { isPinnedTableHit, rerankTableSearchHits } from '../table-search-rerank';

vi.mock('@/lib/boost/scorers/llm-client', () => ({
  callScorerLlm: vi.fn(),
}));

import { callScorerLlm } from '@/lib/boost/scorers/llm-client';

const hit = (partial: Partial<TableSearchHit> & Pick<TableSearchHit, 'path' | 'match'>): TableSearchHit => ({
  kind: 'table',
  ...partial,
});

describe('table-search-rerank', () => {
  it('pins name/path matches', () => {
    expect(isPinnedTableHit('payroll', hit({ path: 'curated.hr.payroll', name: 'payroll', match: 'name' }))).toBe(true);
    expect(isPinnedTableHit('payroll', hit({ path: 'curated.hr.v_payroll_facts', match: 'name' }))).toBe(true);
    expect(isPinnedTableHit('payroll', hit({ path: 'x.y.other', match: 'meaning', score: 0.7 }))).toBe(false);
  });

  it('rerank trims meaning tail when pool is large', async () => {
    process.env.ACCESS_TABLE_SEARCH_RERANK = 'true';
    const rows = [
      hit({ path: 'c.s.payroll', name: 'payroll', match: 'name' }),
      ...Array.from({ length: 10 }, (_, i) =>
        hit({ path: `scratch.a.t${i}`, match: 'meaning', score: 0.4, description: 'observations' }),
      ),
    ];
    vi.mocked(callScorerLlm).mockResolvedValueOnce('{"keep":[0]}');
    const out = await rerankTableSearchHits('crew compensation', rows);
    expect(out[0]!.path).toBe('c.s.payroll');
    expect(out.length).toBeLessThan(rows.length);
    delete process.env.ACCESS_TABLE_SEARCH_RERANK;
  });

  it('applyRerankKeepIndices', () => {
    expect(applyRerankKeepIndices(['a', 'b', 'c'], [1])).toEqual(['b']);
  });
});
