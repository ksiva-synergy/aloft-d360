import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  describeIdleContinueBlocker,
  describeIdleContinueScope,
  isJobRowStale,
  normalizePipelineScope,
  readScopeChain,
  summarizeJobScope,
} from '@/lib/estate/pipeline-intent';

describe('normalizePipelineScope', () => {
  it('builds schema include pattern from catalog and schema', () => {
    const { includePatterns } = normalizePipelineScope({
      sourceId: '00000000-0000-0000-0000-000000000001',
      catalog: 'curated_db',
      schema: 'my_schema',
    });
    expect(includePatterns).toEqual(['curated_db.my_schema.*']);
  });

  it('uses catalog wildcard when only catalog set', () => {
    const { includePatterns } = normalizePipelineScope({
      sourceId: 'x',
      catalog: 'curated_db',
    });
    expect(includePatterns).toEqual(['curated_db.*']);
  });

  it('preserves explicit include patterns', () => {
    const { includePatterns } = normalizePipelineScope({
      sourceId: 'x',
      includePatterns: ['a.b.*', 'a.c.*'],
    });
    expect(includePatterns).toEqual(['a.b.*', 'a.c.*']);
  });
});

describe('summarizeJobScope', () => {
  it('describes limit patterns', () => {
    expect(
      summarizeJobScope({ includePatterns: ['curated_db.foo.*'] }),
    ).toBe('Limit: curated_db.foo.*');
  });

  it('reads chain from scope', () => {
    expect(readScopeChain({ chain: ['t1_profile', 't2_semantic'] })).toEqual([
      't1_profile',
      't2_semantic',
    ]);
  });
});

describe('describeIdleContinueScope', () => {
  it('names tables that are not in the business model', () => {
    expect(describeIdleContinueScope(1)).toBe(
      'Search is current. 1 table is not in the business model. Open Continue and select Usage and/or Business model.',
    );
    expect(describeIdleContinueScope(0)).toBe(
      'Nothing stale to run in this scope for the selected tiers',
    );
  });

  it('keeps the source-check message when every described table is in the model', () => {
    expect(describeIdleContinueBlocker(0, true)).toBe(
      'No source changes and all tiers through embed are current for this scope.',
    );
    expect(describeIdleContinueBlocker(2, true)).toContain('Open Continue and select Usage and/or Business model');
  });
});

describe('isJobRowStale', () => {
  it('flags old running jobs', () => {
    const old = new Date(Date.now() - 31 * 60 * 1000);
    expect(isJobRowStale(old, 'running')).toBe(true);
  });

  it('ignores queued jobs', () => {
    expect(isJobRowStale(null, 'queued')).toBe(false);
  });
});
