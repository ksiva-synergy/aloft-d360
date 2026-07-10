// dataReadinessColors.ts — single source of truth for DATA readiness color functions.
//
// Approved source: Estate Object Detail.dc.html bundle-src (inspected DS2a patch).
//
// THREE DISTINCT COLOR SOURCES — do not conflate:
//   1. scoreColor(score)  — per-dimension severity; score is 0..1 (DimensionResult.score scale)
//   2. levelColor(level)  — composite level badge center only (L1–L5)
//   3. GATING_CHIP_*      — GATING chip, always fixed warn color regardless of score band
//
// Thresholds are the approved source's 45/65/85 percentages rescaled to 0..1 to match
// the DimensionResult.score type (which is 0..1 inclusive, per types.ts).

import type { LevelBand } from '@/lib/context/data-score';

/**
 * Per-dimension severity color based on the dimension's own score.
 * Apply to: ring arc stroke, legend swatch background, progress bar fill, percentage text.
 *
 * Approved thresholds (0–100 scale from .dc.html):
 *   s < 45  → poor   #C25A2E
 *   s < 65  → weak   #D19A1E
 *   s < 85  → solid  #2F6DB0
 *   s ≥ 85  → strong #3B7A4B
 *
 * Rescaled to 0..1 (DimensionResult.score type):
 *   s < 0.45 → poor
 *   s < 0.65 → weak
 *   s < 0.85 → solid
 *   s ≥ 0.85 → strong
 */
export function scoreColor(score: number): string {
  if (score < 0.45) return '#C25A2E';
  if (score < 0.65) return '#D19A1E';
  if (score < 0.85) return '#2F6DB0';
  return '#3B7A4B';
}

/**
 * Composite level badge color — used ONLY for the center "L1"–"L5" badge in the ring.
 * NOT to be used for individual dimension segments.
 *
 * L4 and L3 intentionally share the same blue (#2F6DB0) per the approved source.
 */
export function levelColor(level: LevelBand): string {
  const map: Record<LevelBand, string> = {
    L1: '#C25A2E',
    L2: '#B4801A',
    L3: '#2F6DB0',
    L4: '#2F6DB0',
    L5: '#3B7A4B',
  };
  return map[level];
}

/**
 * GATING chip fixed warn color — independent of the gating dimension's score band.
 * The chip is always warn-colored regardless of whether the gating dimension scores
 * poor, weak, solid, or strong.
 */
export const GATING_CHIP_COLOR = '#C25A2E';
export const GATING_CHIP_BG    = 'rgba(194,90,46,.14)';
