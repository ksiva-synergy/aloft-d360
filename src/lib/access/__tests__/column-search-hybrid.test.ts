import { describe, expect, it } from 'vitest';
import { mergeColumnSearchHits } from '../column-search-hybrid';

describe('mergeColumnSearchHits', () => {
  it('keeps name hits first and adds meaning-only columns', () => {
    const merged = mergeColumnSearchHits(
      'pay',
      [{ tablePath: 'a.b.t', column: 'pay_rate', type: 'int', kind: 'table', tagIds: [] }],
      [
        { tablePath: 'a.b.t', column: 'pay_rate', type: 'int', kind: 'table', description: 'dup', score: 0.9 },
        { tablePath: 'a.b.u', column: 'bonus', type: 'int', kind: 'table', description: 'extra', score: 0.8 },
      ],
      () => [],
    );
    expect(merged.map((r) => r.column)).toEqual(['pay_rate', 'bonus']);
    expect(merged[0]!.match).toBe('name');
    expect(merged[1]!.match).toBe('meaning');
  });
});
