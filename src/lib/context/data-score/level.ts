// Level derivation — single source of truth for composite → L1–L5 mapping.
// Also exports compositeFromDimensions which computes min() with deterministic
// tie-breaking.

import type { DataDimension, DimensionResult, LevelBand, DataScoreResult } from './types';
import { DIMENSION_PRIORITY, LEVEL_BANDS } from './types';

// ── Composite (min-of-four) ──────────────────────────────────────────────────

export function compositeFromDimensions(results: Record<DataDimension, DimensionResult>): {
  composite: number;
  gating_dimension: DataDimension;
} {
  const minScore = Math.min(
    results.discoverable.score,
    results.accessible.score,
    results.trusted.score,
    results.actionable.score,
  );

  // Deterministic tie-breaking: first dimension in DIMENSION_PRIORITY that
  // shares the minimum value becomes the gating dimension.
  // This prevents flapping between runs on floating-point noise.
  const gating_dimension = DIMENSION_PRIORITY.find(
    (d) => results[d].score === minScore,
  ) as DataDimension;

  return { composite: minScore, gating_dimension };
}

// ── Level bands ──────────────────────────────────────────────────────────────

// Bands are checked from highest to lowest; first match wins.
// L1: [0,    0.20)
// L2: [0.20, 0.45)
// L3: [0.45, 0.65)
// L4: [0.65, 0.85)
// L5: [0.85, 1.0 ]
export function levelFromComposite(composite: number): LevelBand {
  for (const { level, min } of LEVEL_BANDS) {
    if (composite >= min) return level;
  }
  return 'L1';
}

// ── Full result assembly ─────────────────────────────────────────────────────

export function assembleDataScoreResult(
  results: Record<DataDimension, DimensionResult>,
): DataScoreResult {
  const { composite, gating_dimension } = compositeFromDimensions(results);
  const level = levelFromComposite(composite);
  return {
    discoverable: results.discoverable,
    accessible: results.accessible,
    trusted: results.trusted,
    actionable: results.actionable,
    composite,
    level,
    gating_dimension,
  };
}
