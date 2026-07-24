import { describe, it, expect } from 'vitest';
import { classifyDraftFreshness } from '../draft';

describe('classifyDraftFreshness (Track B / B3 hydrate case selection)', () => {
  it('returns none when no draft row exists (→ hydrate current version)', () => {
    expect(classifyDraftFreshness(false, null, null)).toBe('none');
    expect(classifyDraftFreshness(false, 'v1', 'v1')).toBe('none');
  });

  it('returns fresh when the draft forked from the still-current version', () => {
    expect(classifyDraftFreshness(true, 'v2', 'v2')).toBe('fresh');
  });

  it('returns stale when a newer version was saved since the draft forked', () => {
    // Someone else committed v3 while this user was drafting on top of v2.
    expect(classifyDraftFreshness(true, 'v2', 'v3')).toBe('stale');
  });

  it('treats the new-dashboard cold start (null == null) as fresh, not stale', () => {
    // Eager-created dashboard, no version yet, draft forked from "no version".
    // Must NOT surface the reconcile banner — there is nothing newer.
    expect(classifyDraftFreshness(true, null, null)).toBe('fresh');
  });

  it('returns stale when the dashboard gained its first version after the draft', () => {
    // Draft forked pre-first-save (null); a version now exists → reconcile.
    expect(classifyDraftFreshness(true, null, 'v1')).toBe('stale');
  });

  it('returns stale when the draft has a base but the pointer was cleared', () => {
    expect(classifyDraftFreshness(true, 'v1', null)).toBe('stale');
  });
});
