import { describe, expect, it, vi } from 'vitest';
import type { ColumnSearchHit } from '../column-search-hybrid';
import { applyRerankKeepIndices } from '../search-rerank-parse';
import { isPinnedColumnHit, rerankColumnSearchHits } from '../column-search-rerank';

vi.mock('@/lib/boost/scorers/llm-client', () => ({
  callScorerLlm: vi.fn(),
}));

import { callScorerLlm } from '@/lib/boost/scorers/llm-client';

const hit = (partial: Partial<ColumnSearchHit> & Pick<ColumnSearchHit, 'column' | 'tablePath' | 'match'>): ColumnSearchHit => ({
  type: 'string',
  kind: 'table',
  tagIds: [],
  ...partial,
});

describe('column-search-rerank', () => {
  it('pins exact and substring name hits', () => {
    expect(isPinnedColumnHit('salary', hit({ column: 'salary', tablePath: 'a.b.c', match: 'name' }))).toBe(true);
    expect(isPinnedColumnHit('salary', hit({ column: 'base_salary', tablePath: 'a.b.c', match: 'name' }))).toBe(true);
    expect(isPinnedColumnHit('salary', hit({ column: 'bonus', tablePath: 'a.b.c', match: 'meaning', score: 0.8 }))).toBe(false);
  });

  it('applyRerankKeepIndices filters pool', () => {
    const pool = [hit({ column: 'a', tablePath: 'x', match: 'meaning' }), hit({ column: 'b', tablePath: 'x', match: 'meaning' })];
    expect(applyRerankKeepIndices(pool, [1]).map((h) => h.column)).toEqual(['b']);
  });

  it('rerank keeps pinned name hits and LLM-selected tail', async () => {
    process.env.ACCESS_COLUMN_SEARCH_RERANK = 'true';
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ column: i === 0 ? 'salary' : `email_${i}`, tablePath: `c.s.t${i}`, match: i === 0 ? 'name' : 'meaning', score: 0.5 }),
    );
    vi.mocked(callScorerLlm).mockResolvedValueOnce('{"keep":[0]}');
    const out = await rerankColumnSearchHits('salary', many);
    expect(out[0]!.column).toBe('salary');
    expect(out.length).toBeLessThan(many.length);
    delete process.env.ACCESS_COLUMN_SEARCH_RERANK;
  });
});
