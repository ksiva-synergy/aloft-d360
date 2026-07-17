/**
 * src/lib/dashboards/widget-diff.ts
 *
 * Pure widget-diff computation for the Phase 3B draft-then-accept flow.
 *
 * When the copilot proposes a change to an existing dashboard widget (a chart
 * refined in the Inspector chat, applied back to its source widget), the UI
 * shows a before/after diff instead of silently overwriting. computeWidgetDiff
 * is the heart of that: given the current WidgetSpec (`before`) and the proposed
 * WidgetSpec (`after`), it returns a compact, human-renderable description of
 * exactly what changed.
 *
 * PURE module — no I/O, no React, no Prisma — so every branch is unit-testable
 * (see __tests__/widget-diff.test.ts).
 *
 * Field IDs are opaque cuid2s; the caller passes an optional `resolveLabel` so
 * the added/removed lists surface human labels ("Region") rather than raw IDs.
 * When omitted, the raw ID is used verbatim (keeps the function pure + testable
 * without a definitions map).
 */

import type { WidgetSpec } from './types';

export interface WidgetDiff {
  /** chartKind changed, e.g. { from: 'bar', to: 'line' }. */
  chartKindChanged?: { from: string; to: string };
  /** Dimension labels added in `after` (not present in `before`). */
  dimensionsAdded?: string[];
  /** Dimension labels removed from `before` (not present in `after`). */
  dimensionsRemoved?: string[];
  /** Measure labels added in `after`. */
  measuresAdded?: string[];
  /** Measure labels removed from `before`. */
  measuresRemoved?: string[];
  /** True when the filter set differs (added/removed/edited). */
  filtersChanged?: boolean;
  /** True when the chartConfig (axis mapping / echarts overrides) differs. */
  configChanged?: boolean;
}

/** Resolve a field ID to a human label. Kind disambiguates dim/measure ID spaces. */
export type WidgetDiffLabelResolver = (
  id: string,
  kind: 'dimension' | 'measure',
) => string;

const identityResolver: WidgetDiffLabelResolver = (id) => id;

/** Stable stringify for order-sensitive structural comparison of arrays/objects. */
function stableEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Compute the diff between two widget specs. Returns an object with a key set
 * ONLY for the dimensions that actually changed — an empty object ({}) means no
 * change. Use `widgetDiffIsEmpty` to test for that.
 */
export function computeWidgetDiff(
  before: WidgetSpec,
  after: WidgetSpec,
  resolveLabel: WidgetDiffLabelResolver = identityResolver,
): WidgetDiff {
  const diff: WidgetDiff = {};

  // ── Chart kind ──────────────────────────────────────────────────────────
  if (before.chartKind !== after.chartKind) {
    diff.chartKindChanged = { from: before.chartKind, to: after.chartKind };
  }

  // ── Dimensions (compared by dimensionId; labels surfaced) ───────────────
  const beforeDims = new Set(before.semanticQuery.dimensions.map((d) => d.dimensionId));
  const afterDims = new Set(after.semanticQuery.dimensions.map((d) => d.dimensionId));

  const dimsAdded = [...afterDims]
    .filter((id) => !beforeDims.has(id))
    .map((id) => resolveLabel(id, 'dimension'));
  const dimsRemoved = [...beforeDims]
    .filter((id) => !afterDims.has(id))
    .map((id) => resolveLabel(id, 'dimension'));
  if (dimsAdded.length > 0) diff.dimensionsAdded = dimsAdded;
  if (dimsRemoved.length > 0) diff.dimensionsRemoved = dimsRemoved;

  // ── Measures (compared by measureId; labels surfaced) ───────────────────
  const beforeMeasures = new Set(before.semanticQuery.measures.map((m) => m.measureId));
  const afterMeasures = new Set(after.semanticQuery.measures.map((m) => m.measureId));

  const measuresAdded = [...afterMeasures]
    .filter((id) => !beforeMeasures.has(id))
    .map((id) => resolveLabel(id, 'measure'));
  const measuresRemoved = [...beforeMeasures]
    .filter((id) => !afterMeasures.has(id))
    .map((id) => resolveLabel(id, 'measure'));
  if (measuresAdded.length > 0) diff.measuresAdded = measuresAdded;
  if (measuresRemoved.length > 0) diff.measuresRemoved = measuresRemoved;

  // ── Filters (structural compare — added / removed / edited) ─────────────
  if (!stableEquals(before.semanticQuery.filters, after.semanticQuery.filters)) {
    diff.filtersChanged = true;
  }

  // ── Chart config (axis mapping + echarts overrides) ─────────────────────
  if (!stableEquals(before.chartConfig, after.chartConfig)) {
    diff.configChanged = true;
  }

  return diff;
}

/** True when the diff carries no changes (i.e. before and after are equivalent). */
export function widgetDiffIsEmpty(diff: WidgetDiff): boolean {
  return Object.keys(diff).length === 0;
}

/**
 * Render a diff as an ordered list of human-readable change lines, e.g.
 *   ["Changed chart kind: bar → line", "Added dimension: Region"]
 * Empty array when there is no change. UI-agnostic (no JSX) so it is testable.
 */
export function summarizeWidgetDiff(diff: WidgetDiff): string[] {
  const lines: string[] = [];
  if (diff.chartKindChanged) {
    lines.push(`Changed chart kind: ${diff.chartKindChanged.from} → ${diff.chartKindChanged.to}`);
  }
  if (diff.dimensionsAdded?.length) {
    lines.push(`Added dimension: ${diff.dimensionsAdded.join(', ')}`);
  }
  if (diff.dimensionsRemoved?.length) {
    lines.push(`Removed dimension: ${diff.dimensionsRemoved.join(', ')}`);
  }
  if (diff.measuresAdded?.length) {
    lines.push(`Added measure: ${diff.measuresAdded.join(', ')}`);
  }
  if (diff.measuresRemoved?.length) {
    lines.push(`Removed measure: ${diff.measuresRemoved.join(', ')}`);
  }
  if (diff.filtersChanged) {
    lines.push('Filters changed');
  }
  if (diff.configChanged) {
    lines.push('Chart configuration changed');
  }
  return lines;
}
