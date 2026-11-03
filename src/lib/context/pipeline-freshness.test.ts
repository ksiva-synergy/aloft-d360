import { describe, expect, it } from 'vitest';
import {
  buildContinueChain,
  buildContinueKindsFromTierSelection,
  classifyScopeChanges,
  isProfileUnchanged,
  isT0Changed,
  scopeNeedsRescan,
} from './pipeline-freshness';

const T = (s: string) => new Date(s);

const cols = [
  { name: 'id', ordinal: 1, data_type: 'bigint', is_nullable: false, native_comment: null },
  { name: 'name', ordinal: 2, data_type: 'string', is_nullable: true, native_comment: 'n' },
];

describe('isT0Changed', () => {
  const stored = {
    lifecycle: 'active',
    last_t0_at: T('2026-07-02T00:00:00Z'),
    source_altered_at: T('2026-07-01T00:00:00Z'),
    object_kind: 'table',
    native_comment: null,
    columns: cols,
  };

  it('is unchanged when structure and alter time match', () => {
    expect(isT0Changed(stored, { ...stored, columns: [...cols].reverse() })).toBe(false);
  });

  it('is changed for new / dropped / never-scanned objects', () => {
    expect(isT0Changed(null, stored)).toBe(true);
    expect(isT0Changed({ ...stored, lifecycle: 'dropped' }, stored)).toBe(true);
    expect(isT0Changed({ ...stored, last_t0_at: null }, stored)).toBe(true);
  });

  it('is changed when the source alter time moves forward', () => {
    expect(isT0Changed(stored, { ...stored, source_altered_at: T('2026-08-01T00:00:00Z') })).toBe(true);
  });

  it('is changed when a column type changes or a column is added', () => {
    expect(isT0Changed(stored, { ...stored, columns: [cols[0], { ...cols[1], data_type: 'int' }] })).toBe(true);
    expect(isT0Changed(stored, { ...stored, columns: [...cols, { name: 'x', ordinal: 3, data_type: 'int' }] })).toBe(true);
  });

  it('ignores stale stored columns absent from the source (alter time covers drops)', () => {
    expect(isT0Changed({ ...stored, columns: [...cols, { name: 'old', ordinal: 3 }] }, stored)).toBe(false);
  });
});

describe('isProfileUnchanged', () => {
  it('ignores volatile keys and key order', () => {
    const a = { row_count: 5, query_count: 2, columns: { id: { null_rate: 0, distinct_est: 5 } } };
    const b = { columns: { id: { distinct_est: 5, null_rate: 0 } }, query_count: 3, row_count: 5 };
    expect(isProfileUnchanged(a, b)).toBe(true);
  });

  it('detects real stat changes and missing previous profile', () => {
    expect(isProfileUnchanged({ row_count: 5 }, { row_count: 6 })).toBe(false);
    expect(isProfileUnchanged(null, { row_count: 6 })).toBe(false);
  });
});

describe('classifyScopeChanges', () => {
  const includes = ['c.s.*'];
  const stored = [
    { full_path: 'c.s.a', source_altered_at: T('2026-07-01T00:00:00Z'), last_t0_at: T('2026-07-02T00:00:00Z') },
    { full_path: 'c.s.b', source_altered_at: T('2026-07-01T00:00:00Z'), last_t0_at: T('2026-07-02T00:00:00Z') },
    { full_path: 'c.s.gone', source_altered_at: null, last_t0_at: T('2026-07-02T00:00:00Z') },
  ];

  it('classifies unchanged / changed / new / dropped / unknown', () => {
    const r = classifyScopeChanges({
      listed: [
        { full_path: 'c.s.a', source_altered_at: T('2026-07-01T00:00:00Z') },
        { full_path: 'c.s.b', source_altered_at: T('2026-09-01T00:00:00Z') },
        { full_path: 'c.s.new', source_altered_at: T('2026-09-01T00:00:00Z') },
      ],
      stored,
      includes,
      excludes: [],
    });
    expect(r.unchanged).toBe(1);
    expect(r.changed).toEqual(['c.s.b']);
    expect(r.added).toEqual(['c.s.new']);
    expect(r.dropped).toEqual(['c.s.gone']);
    expect(scopeNeedsRescan(r)).toBe(true);
  });

  it('reports nothing to rescan when the source is unchanged', () => {
    const r = classifyScopeChanges({
      listed: stored.slice(0, 2).map(s => ({ full_path: s.full_path, source_altered_at: s.source_altered_at })),
      stored: stored.slice(0, 2),
      includes,
      excludes: [],
    });
    expect(scopeNeedsRescan(r)).toBe(false);
    expect(r.unchanged).toBe(2);
  });

  it('treats missing alter time as unknown (T0 decides by structure)', () => {
    const r = classifyScopeChanges({
      listed: [{ full_path: 'c.s.a', source_altered_at: null }],
      stored: stored.slice(0, 1),
      includes,
      excludes: [],
    });
    expect(r.unknown).toEqual(['c.s.a']);
  });
});

describe('buildContinueChain', () => {
  const none = { rescan: false, needsProfile: 0, needsEnrich: 0, needsEmbed: 0 };
  it('runs only embed when nothing changed and only embedding is pending', () => {
    expect(buildContinueChain({ ...none, needsEmbed: 10 }, 'embed')).toEqual(['embed']);
  });

  it('never drops describe when profile is stale (cascade)', () => {
    expect(buildContinueChain({ ...none, needsProfile: 10, needsEmbed: 10 }, 'embed')).toEqual([
      't1_profile',
      't2_semantic',
      'embed',
    ]);
  });

  it('starts at scan when the source changed', () => {
    expect(buildContinueChain({ ...none, rescan: true }, 'embed')).toEqual([
      't0_structural',
      't1_profile',
      't2_semantic',
      'embed',
    ]);
  });

  it('respects `through` and returns empty when idle', () => {
    expect(buildContinueChain({ ...none, needsProfile: 1 }, 't1_profile')).toEqual(['t1_profile']);
    expect(buildContinueChain({ ...none, needsEmbed: 1 }, 't2_semantic')).toEqual([]);
    expect(buildContinueChain(none, 'embed')).toEqual([]);
  });
});

describe('buildContinueKindsFromTierSelection', () => {
  const none = { rescan: false, needsProfile: 0, needsEnrich: 0, needsEmbed: 0 };

  it('runs usage and business model when embed work is current', () => {
    expect(
      buildContinueKindsFromTierSelection({
        selectedTiers: ['t3', 't4'],
        needs: none,
        scannedObjects: 1,
        notInModel: 1,
      }),
    ).toEqual(['t3_usage', 't4_scan']);
  });

  it('still cascades embed tiers when they are stale', () => {
    expect(
      buildContinueKindsFromTierSelection({
        selectedTiers: ['t1', 't2', 'embed'],
        needs: { ...none, needsProfile: 2 },
        scannedObjects: 5,
        notInModel: 0,
      }),
    ).toEqual(['t1_profile', 't2_semantic', 'embed']);
  });
});
