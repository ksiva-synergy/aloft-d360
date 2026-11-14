import { describe, expect, it } from 'vitest';

import { scopeModelIds, scopesOverlap } from '@/lib/powerbi/model-scope';

describe('one writer per model', () => {
  it('reads model ids from a job scope; a missing list means every model', () => {
    expect(scopeModelIds({ model_ids: ['a', 'b', 3] })).toEqual(['a', 'b']);
    expect(scopeModelIds({})).toBeUndefined();
    expect(scopeModelIds(null)).toBeUndefined();
  });

  it('scopes overlap when they share a model or either covers every model', () => {
    expect(scopesOverlap(['a', 'b'], ['b'])).toBe(true);
    expect(scopesOverlap(['a'], ['c'])).toBe(false);
    expect(scopesOverlap(undefined, ['c'])).toBe(true);
    expect(scopesOverlap(['a'], undefined)).toBe(true);
  });
});
