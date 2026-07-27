/**
 * src/lib/dashboards/sample-data.ts
 *
 * Deterministic, LOCALLY-GENERATED sample data for the "show-don't-describe"
 * guided dashboard-builder previews (Blueprint thumbnails + the Refine canvas
 * before a query has run).
 *
 * ── PURITY IS A GOVERNANCE INVARIANT, NOT JUST TEST HYGIENE ──────────────────
 * This module NEVER does I/O. It does not fetch, it does not call
 * executeSemanticQuery / executeDatabricksSQL, it imports nothing that touches
 * the warehouse. Sample previews must render before any query runs and MUST NOT
 * round-trip to the governed-only execution path to "look more realistic" — that
 * would be a bypass around the governed-only gate through the preview surface.
 * The only inputs are labels/ids already in hand on the client. If you are
 * tempted to make a sample look real by fetching, don't: that is the exact seam
 * this comment exists to protect.
 *
 * ── DETERMINISM IS SEEDED OFF MEASURE IDENTITY, NOT THE CARD ─────────────────
 * A series' sample values are seeded from the measure's stable identity
 * (definition id when present, else its label) — never from card position or the
 * surrounding item set. So the same metric produces the same shape in every
 * thumbnail and in both stages, and (paired with colorForMeasure keyed on the
 * same identity) the "same metric = same colour" invariant holds visually, not
 * just in the palette. Output is a `RowsToOptionResult`, the SAME shape the real
 * `rowsToOption` mapper emits, so sample mode and real mode share ONE option
 * builder in SamplePreviewChart.
 */

import { toAlias } from '@/lib/semantic/compiler';
import type { RowsToOptionResult, SeriesResolution } from './rows-to-option';
import type { ChartKindGuess } from './guided-types';

export interface SampleDataInput {
  chartKind: ChartKindGuess;
  /** Series labels (legend names). */
  measureLabels: string[];
  /** Category-axis labels; dimensionLabels[0] drives the x categories. */
  dimensionLabels: string[];
  /** Stable per-series identity for seeding — falls back to the label. */
  measureIds?: string[];
  /**
   * Domain-specific example values per dimension label, sourced from the semantic
   * model's governed definitions (e.g. "Vessel Type" → ["Tanker", "Bulk Carrier"]).
   * When present, these replace the generic NATO-alphabet categories so the preview
   * reflects the actual business domain rather than Alpha/Bravo/Charlie.
   * Falls back to the generic vocabulary when absent or when the dimension label
   * doesn't match any key. PURITY IS PRESERVED: these values come from the client's
   * already-loaded definitions — no I/O occurs here.
   */
  dimensionHints?: Record<string, string[]>;
}

// ── Deterministic PRNG (mulberry32) seeded from a string identity ─────────────
/** 32-bit string hash → seed. Order-sensitive so distinct labels spread out. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic PRNG. Same seed → same sequence, always. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Human-ish category vocabularies (deterministic, no randomness in selection).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CAT_WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
const TIME_HINTS = ['month', 'date', 'quarter', 'year', 'week', 'day', 'time', 'period'];

function isTimeish(label: string): boolean {
  const l = label.toLowerCase();
  return TIME_HINTS.some((h) => l.includes(h));
}

/** Point count per kind — enough to read the shape, not enough to clutter. */
function pointCountFor(kind: ChartKindGuess): number {
  if (kind === 'kpi') return 1;
  if (kind === 'line' || kind === 'scatter') return 8;
  return 6; // bar / pie / heatmap / table
}

/**
 * Build a deterministic `RowsToOptionResult` for a preview. Pure: identical
 * inputs always yield identical output, and there is no I/O of any kind.
 */
export function buildSampleData(input: SampleDataInput): RowsToOptionResult {
  const { chartKind, measureLabels, dimensionLabels, measureIds, dimensionHints } = input;

  const n = pointCountFor(chartKind);
  const dim0 = dimensionLabels[0];

  // Categories from dim[0] (KPI has none).
  // Priority: (1) domain hints for dim0 label, (2) time-ish → month labels,
  // (3) NATO-ish generic vocabulary. Never randomised selection.
  let categories: string[] = [];
  if (chartKind !== 'kpi') {
    const hints = dim0 && dimensionHints?.[dim0];
    if (hints && hints.length > 0) {
      // Use domain-specific values, cycling if fewer than n points needed.
      categories = Array.from({ length: n }, (_, i) => hints[i % hints.length]);
    } else if (dim0 && isTimeish(dim0)) {
      categories = MONTHS.slice(0, n);
    } else if (dim0) {
      categories = Array.from({ length: n }, (_, i) => CAT_WORDS[i % CAT_WORDS.length]);
    } else {
      categories = Array.from({ length: n }, (_, i) => String(i + 1));
    }
  }

  const dimAliases = dimensionLabels.map((d) => toAlias(d));
  const points = chartKind === 'kpi' ? 1 : categories.length;

  const series: SeriesResolution[] = measureLabels.map((label, i) => {
    // Seed off the measure's STABLE IDENTITY, not the card — the invariant the
    // "same metric same shape/colour everywhere" guarantee rests on.
    const identity = measureIds?.[i] || label;
    const rand = mulberry32(hashSeed(identity));
    const base = 40 + Math.floor(rand() * 60); // 40..100 baseline, per-measure
    const data = Array.from({ length: points }, () =>
      Math.max(1, Math.round(base * (0.6 + rand() * 0.8))),
    );
    return {
      measureId: identity,
      name: label,
      alias: toAlias(label),
      data,
      unit: null,
      format: null,
    };
  });

  return { isEmpty: false, categories, dimAliases, series };
}
