import {
  widgetCacheKey,
  getFreshCached,
  setCached,
  clearWidgetCache,
} from '../widget-cache';
import type { SemanticQuery } from '../../semantic/types';

// Phase 2 freshness — the process-local cache is a TTL cache keyed by
// (connectionId + pinned query). These tests lock the two behaviours the data
// route relies on: deterministic keying and stale-after-N-seconds eviction.

const baseQuery: SemanticQuery = {
  modelId: 'model_a',
  entityId: 'entity_a',
  dimensions: [{ dimensionId: 'd1' }],
  measures: [{ measureId: 'm1' }],
  filters: [],
  sorts: [],
};

describe('widgetCacheKey', () => {
  it('is stable regardless of object key insertion order', () => {
    const reordered: SemanticQuery = {
      sorts: [],
      filters: [],
      measures: [{ measureId: 'm1' }],
      dimensions: [{ dimensionId: 'd1' }],
      entityId: 'entity_a',
      modelId: 'model_a',
    };
    expect(widgetCacheKey('conn1', baseQuery)).toBe(widgetCacheKey('conn1', reordered));
  });

  it('differs by connection and by query content', () => {
    expect(widgetCacheKey('conn1', baseQuery)).not.toBe(widgetCacheKey('conn2', baseQuery));
    const other = { ...baseQuery, measures: [{ measureId: 'm2' }] };
    expect(widgetCacheKey('conn1', baseQuery)).not.toBe(widgetCacheKey('conn1', other));
  });
});

describe('getFreshCached / setCached', () => {
  beforeEach(() => clearWidgetCache());

  it('returns a stored entry while within the staleAfterSec window', () => {
    const key = widgetCacheKey('conn1', baseQuery);
    const t0 = 1_000_000;
    setCached(key, { rows: [{ x: 1 }], sql: 'SELECT 1' }, t0);

    // 200s later, TTL 300s → hit, and executedAt reflects the ORIGINAL run.
    const hit = getFreshCached(key, 300, t0 + 200_000);
    expect(hit).not.toBeNull();
    expect(hit!.rows).toEqual([{ x: 1 }]);
    expect(hit!.executedAt).toBe(new Date(t0).toISOString());
  });

  it('misses and evicts once older than staleAfterSec', () => {
    const key = widgetCacheKey('conn1', baseQuery);
    const t0 = 2_000_000;
    setCached(key, { rows: [{ x: 1 }], sql: 'SELECT 1' }, t0);

    // 301s later, TTL 300s → stale.
    expect(getFreshCached(key, 300, t0 + 301_000)).toBeNull();
    // The stale entry was dropped, so an immediate re-check also misses.
    expect(getFreshCached(key, 300, t0 + 301_000)).toBeNull();
  });

  it('returns null for an unknown key', () => {
    expect(getFreshCached('nope', 300, 12345)).toBeNull();
  });
});
