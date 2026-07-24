/**
 * src/lib/dashboards/draft.ts
 *
 * Pure helpers for the Track B draft-retention layer. Kept framework-free so the
 * freshness classification — which decides the builder's hydrate path (B3) — is
 * unit-testable without a DB or a request.
 */

/**
 * Freshness of a per-user draft relative to the dashboard's current version:
 *   - 'none'  → no draft row exists.
 *   - 'fresh' → the draft forked from the version that is still current →
 *     hydrate silently ("Unsaved changes restored · Discard").
 *   - 'stale' → a newer version was saved since the draft forked →
 *     reconcile ("Keep draft / Discard / View diff").
 */
export type DraftFreshness = 'none' | 'fresh' | 'stale';

/**
 * Classify a draft against the dashboard's current version.
 *
 * NOTE on NULL == NULL: a draft forked from a dashboard that has never saved a
 * version (base_version_id = null) while the dashboard still has no version
 * (current_version_id = null) is 'fresh' — there is nothing newer to reconcile.
 * This is the new-dashboard cold-start path (dashboards are eager-created with
 * current_version_id = null), so it must NOT read as 'stale'.
 *
 * ⚠️ KEEP THIS IN TypeScript — do NOT reimplement the comparison in SQL. JS
 * `null === null` is `true` (cold start → fresh), but SQL `NULL = NULL` is `NULL`
 * (falsy), which would silently flip every cold-start draft to 'stale' and pop a
 * spurious reconcile banner on brand-new dashboards. A SQL predicate would need
 * an explicit `IS NOT DISTINCT FROM`. There is no browser test guarding this.
 *
 * @param hasDraft          whether a draft row exists for this (dashboard, user)
 * @param baseVersionId     the version the draft forked from (null = pre-first-save)
 * @param currentVersionId  the dashboard's current version (null = no version yet)
 */
export function classifyDraftFreshness(
  hasDraft: boolean,
  baseVersionId: string | null,
  currentVersionId: string | null,
): DraftFreshness {
  if (!hasDraft) return 'none';
  return baseVersionId === currentVersionId ? 'fresh' : 'stale';
}
