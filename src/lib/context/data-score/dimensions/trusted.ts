// T — Trusted
// Question: Is this object's data fresh, stable, and validated?
//
// Sub-scores:
//   Freshness   — not stale (source_altered <= last_t0)      (+0.35)
//   Stability   — low drift across profile history           (+0.00..0.30)
//   Validation  — semantic status ladder                     (+0.00..0.35)
//
// Drift scale (events with non-null drift in last 10 profiles):
//   0 events  → +0.30
//   1 event   → +0.25
//   2 events  → +0.20
//   3 events  → +0.15
//   4+ events → +0.05
//
// Semantic status sub-score (explicit null branch — common for T0/T1-only objects):
//   null (no card — T2 never ran) → +0.00
//   'assumed'                     → +0.10
//   'confirmed'                   → +0.20
//   'certified'                   → +0.35

import type { DimensionFn, DimensionResult } from '../types';

const DRIFT_SCORE: Record<number, number> = { 0: 0.30, 1: 0.25, 2: 0.20, 3: 0.15 };
const DRIFT_SCORE_MANY = 0.05;

function semanticStatusScore(
  latestSemanticCard: unknown | null,
  latestSemanticStatus: string | null,
): { sub: number; reason: string | null } {
  if (latestSemanticCard === null) {
    return { sub: 0.0, reason: 'No semantic card — Trust cannot be fully assessed until T2 runs' };
  }
  switch (latestSemanticStatus) {
    case 'certified':
      return { sub: 0.35, reason: null };
    case 'confirmed':
      return { sub: 0.20, reason: null };
    case 'assumed':
      return { sub: 0.10, reason: "Semantic card is 'assumed' — LLM-generated, not yet human-validated" };
    default:
      return { sub: 0.10, reason: `Semantic card status '${latestSemanticStatus ?? 'unknown'}' — unrecognized tier` };
  }
}

export const scoreTrusted: DimensionFn = (input): DimensionResult => {
  const { freshness, profileHistory, latestSemanticCard, latestSemanticStatus } = input;
  const reasons: string[] = [];
  let score = 0;

  // Freshness
  if (!freshness.stale) {
    score += 0.35;
  } else {
    reasons.push('Source altered since last harvest — data may be outdated');
  }

  // Drift stability
  const driftEventCount = profileHistory.filter((p) => p.drift != null).length;
  const driftSub = driftEventCount >= 4 ? DRIFT_SCORE_MANY : (DRIFT_SCORE[driftEventCount] ?? DRIFT_SCORE_MANY);
  score += driftSub;
  if (driftEventCount >= 2) {
    reasons.push(`High schema/data drift detected (${driftEventCount} events in recent history)`);
  }

  // Semantic validation
  const { sub: semanticSub, reason: semanticReason } = semanticStatusScore(latestSemanticCard, latestSemanticStatus);
  score += semanticSub;
  if (semanticReason) {
    reasons.push(semanticReason);
  }

  return { score: Math.min(score, 1.0), reasons };
};
