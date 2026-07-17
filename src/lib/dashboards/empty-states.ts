/**
 * src/lib/dashboards/empty-states.ts
 *
 * Deterministic starter-prompt generation for generative empty states
 * (Phase 3B, Deliverable 4). Given a semantic model's dimensions and measures,
 * build a handful of natural-language analytics questions a business user would
 * plausibly ask — so an empty dashboard or a fresh Inspector session is never a
 * blank slate.
 *
 * Approach A (deterministic templates, no LLM) — fast, offline, and testable.
 * The richer LLM-generated variant is a deliberate Phase 5 upgrade; see the
 * "Decisions to flag" note in the Phase 3B brief.
 *
 * PURE module — no I/O, no React — unit-tested in __tests__/empty-states.test.ts.
 */

import { isTimeDimensionType } from './chart-defaults';

export interface StarterDimension {
  id: string;
  label: string;
  /** platform_sem_dimensions.dimension_type — drives temporal detection. */
  dimension_type?: string;
}

export interface StarterMeasure {
  id: string;
  label: string;
}

/** Max prompts we surface — more than ~5 chips reads as clutter. */
const MAX_PROMPTS = 5;

/**
 * Generate 0–5 starter prompts tailored to a model's shape. Deterministic:
 * same inputs → same ordered output. Returns an empty array when the model has
 * neither a measure to plot nor a dimension to group by (the caller then shows
 * a generic welcome instead).
 *
 * Template priority (highest-signal first, deduped, capped at MAX_PROMPTS):
 *   1. trend over time      — 1 temporal dim + top measure
 *   2. category breakdown   — 1 non-temporal dim + top measure
 *   3. top-N ranking        — 1 non-temporal dim + top measure
 *   4. measure comparison   — 2+ measures
 *   5. single value         — exactly 1 measure, no dims (or as a fallback)
 */
export function generateStarterPrompts(
  dimensions: StarterDimension[],
  measures: StarterMeasure[],
): string[] {
  const prompts: string[] = [];

  const timeDim = dimensions.find((d) => isTimeDimensionType(d.dimension_type));
  const categoricalDim = dimensions.find((d) => !isTimeDimensionType(d.dimension_type));
  const topMeasure = measures[0];

  if (timeDim && topMeasure) {
    prompts.push(`Show ${topMeasure.label} over ${timeDim.label}`);
  }

  if (categoricalDim && topMeasure) {
    prompts.push(`Break down ${topMeasure.label} by ${categoricalDim.label}`);
    prompts.push(`Top 10 ${categoricalDim.label} by ${topMeasure.label}`);
  }

  if (measures.length >= 2) {
    prompts.push(`Compare ${measures[0].label} vs ${measures[1].label}`);
  }

  if (topMeasure && dimensions.length === 0) {
    prompts.push(`What is the total ${topMeasure.label}?`);
  }

  // Fallback: a model with dims but no measure still gets one useful prompt.
  if (prompts.length === 0 && dimensions.length > 0) {
    prompts.push(`Count records by ${dimensions[0].label}`);
  }

  // De-dupe (defensive — templates can overlap on tiny models) and cap.
  return [...new Set(prompts)].slice(0, MAX_PROMPTS);
}

/**
 * The always-available "explain the data" prompt (ThoughtSpot Spotter pattern).
 * Kept separate so callers can pin it first in the chat empty state without it
 * participating in the model-shape templates above.
 */
export const WHAT_IS_THIS_DATA_PROMPT = 'What is this data?';
