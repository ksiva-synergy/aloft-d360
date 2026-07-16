/**
 * src/lib/dashboards/widget-cache.ts
 *
 * Phase 2 freshness (v1): a process-local result cache for dashboard widgets
 * whose freshness.mode === 'cached'.
 *
 * Scope & guarantees (deliberately modest):
 *  - Lives in module scope, so it survives across requests in the SAME server
 *    process and is cleared on restart. NOT distributed — a Redis/shared layer
 *    is a future optimization if the product outgrows single-process serving.
 *  - Keyed by (connectionId + the pinned SemanticQuery). The compiler produces
 *    deterministic SQL for a given (query, model); since a dashboard's model is
 *    fixed and the query is pinned to it at execution time, the serialized query
 *    is an equally-deterministic key — and keying on it avoids compiling the SQL
 *    a second time (which would mean loading the model twice per cache miss) and
 *    keeps us from touching the query engine (executeSemanticQuery /
 *    compileSemanticQuery stay unchanged, per the Phase 2 constraints).
 *  - Staleness is evaluated at read time against the widget's staleAfterSec, so
 *    one cached row can serve widgets with different TTLs correctly.
 *
 * Correctness note: this is a TTL cache, not a correctness mechanism. If a
 * measure definition changes, a cached result may be served for up to
 * staleAfterSec. That is the intended semantics of "cached" mode; drift is
 * surfaced independently against live definitions via measureSnapshots.
 */

import type { SemanticQuery } from '@/lib/semantic/types';

interface CacheEntry {
  rows: Record<string, unknown>[];
  sql: string;
  /** Epoch ms when the underlying query actually executed. */
  executedAtMs: number;
  /** ISO form of executedAtMs, returned to the client for the stamp. */
  executedAt: string;
}

/** Hard cap on distinct cache keys to bound memory; oldest-inserted evicted. */
const MAX_ENTRIES = 500;

const cache = new Map<string, CacheEntry>();

/** Deterministic JSON: object keys sorted; array order preserved (it matters). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Build the cache key for a connection + pinned query. */
export function widgetCacheKey(connectionId: string, query: SemanticQuery): string {
  return `${connectionId}::${stableStringify(query)}`;
}

/**
 * Return the cached result for `key` if it exists AND is younger than
 * `staleAfterSec`. A stale entry is evicted and null returned. `nowMs` is
 * injected so callers (and tests) control the clock.
 */
export function getFreshCached(
  key: string,
  staleAfterSec: number,
  nowMs: number,
): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  const ageSec = (nowMs - entry.executedAtMs) / 1000;
  if (ageSec > staleAfterSec) {
    cache.delete(key);
    return null;
  }
  return entry;
}

/** Store a freshly-executed result under `key`, evicting the oldest if full. */
export function setCached(
  key: string,
  data: { rows: Record<string, unknown>[]; sql: string },
  nowMs: number,
): CacheEntry {
  const entry: CacheEntry = {
    rows: data.rows,
    sql: data.sql,
    executedAtMs: nowMs,
    executedAt: new Date(nowMs).toISOString(),
  };
  // Refresh insertion order on overwrite so the LRU-ish eviction is meaningful.
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return entry;
}

/** Test/maintenance helper — drops every entry. */
export function clearWidgetCache(): void {
  cache.clear();
}
