// ── T2 semantic cost model ────────────────────────────────────────────────────
// Pure helpers for estimating the per-object LLM cost of a T2 semantic job.
// Kept free of prisma / server-only imports so it can be unit-verified in isolation
// (see scripts/context/verify/verify-cost-model.ts). The DB-backed rolling-average
// wrapper lives in queue.ts (estimateT2CostPerObject).

/**
 * Fallback per-object cost (USD) used when there are too few historical samples
 * to derive a rolling average.
 *
 * Derived from measured data — a 227-object t2_semantic job logged
 * cost_usd = $15.88, i.e. $15.88 / 227 ≈ $0.070/object. The previous hard-coded
 * estimate of $0.003/object was ~23× too low.
 */
export const T2_COST_PER_OBJECT_FALLBACK_USD = 0.07;

/** Minimum number of usable historical samples before we trust the rolling average. */
export const T2_COST_MIN_SAMPLES = 3;

/**
 * Derive the per-object T2 cost (USD) from a list of historical job stats blobs.
 *
 * Computes avg(cost_usd / objects_enriched) across all usable samples (a job is
 * usable when both cost_usd and objects_enriched are positive numbers). Falls back
 * to {@link T2_COST_PER_OBJECT_FALLBACK_USD} when fewer than `minSamples` usable
 * samples are available.
 */
export function deriveT2CostPerObject(
  statsList: Array<Record<string, unknown> | null | undefined>,
  minSamples: number = T2_COST_MIN_SAMPLES,
): number {
  const ratios: number[] = [];
  for (const stats of statsList) {
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) continue;
    const cost = typeof stats.cost_usd === 'number' ? stats.cost_usd : null;
    const objects = typeof stats.objects_enriched === 'number' ? stats.objects_enriched : null;
    if (cost === null || objects === null || objects <= 0 || cost <= 0) continue;
    ratios.push(cost / objects);
  }

  if (ratios.length < minSamples) return T2_COST_PER_OBJECT_FALLBACK_USD;
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}
