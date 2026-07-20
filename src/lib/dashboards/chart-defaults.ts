/**
 * src/lib/dashboards/chart-defaults.ts
 *
 * Smart chart defaults — a Tableau "Show Me"-inspired heuristic that maps a
 * SemanticQuery's shape (how many dimensions/measures, and their types) to a
 * recommended chart kind + a human rationale + alternative kinds.
 *
 * PURE module — no I/O, no React, no Prisma — so every rule is exhaustively
 * unit-testable (see __tests__/chart-defaults.test.ts).
 *
 * The recommender is intentionally conservative about cardinality: without a
 * COUNT(DISTINCT ...) probe against the warehouse we cannot know a category's
 * true cardinality, so a non-temporal dimension is treated as low-cardinality
 * (→ bar) unless the caller supplies a cardinality hint. Accurate cardinality
 * detection is a future optimization; the safe default (bar, never pie) holds.
 */

import type { SemanticQuery } from '@/lib/semantic/types';

/**
 * The recommended kinds this module can emit. This is a superset of
 * WidgetSpec['chartKind'] — 'pie' and 'table' have no first-class widget
 * equivalent, so builder integration maps them via recommendedKindToWidgetKind.
 */
export type RecommendedChartKind =
  | 'line'
  | 'bar'
  | 'scatter'
  | 'kpi'
  | 'pie'
  | 'heatmap'
  | 'table';

export interface ChartRecommendation {
  chartKind: RecommendedChartKind;
  /** Human-readable justification, e.g. "1 time dimension + 1 measure = trend over time". */
  rationale: string;
  /** Other valid chart kinds for this shape (never includes chartKind itself). */
  alternatives: RecommendedChartKind[];
}

/** Resolved dimension metadata needed by the heuristic. */
export interface ResolvedDimension {
  id: string;
  /**
   * The dimension_type from platform_sem_dimensions (e.g. 'temporal',
   * 'categorical'). Used to detect time dimensions. Absent → treated as
   * categorical.
   */
  type?: string;
  /**
   * Optional cardinality hint. A number (distinct-value estimate) or a coarse
   * bucket. Absent → treated as low-cardinality (safe default → bar).
   */
  cardinality?: number | 'low' | 'high';
}

export interface ResolvedMeasure {
  id: string;
}

/**
 * Resolved definitions for the fields referenced by a query, keyed by id.
 * Only the referenced dims/measures need be present.
 */
export interface ResolvedDefinitions {
  dimensions: Record<string, ResolvedDimension>;
  measures: Record<string, ResolvedMeasure>;
}

/** Distinct-value count above which a categorical is treated as high-cardinality. */
const HIGH_CARDINALITY_THRESHOLD = 12;

/** Dimension types that represent a time axis (case-insensitive, prefix-matched). */
const TIME_TYPE_PREFIXES = ['temporal', 'date', 'timestamp', 'datetime', 'time'];

/** True when a dimension's declared type represents a point in time. */
export function isTimeDimensionType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.trim().toLowerCase();
  return TIME_TYPE_PREFIXES.some((p) => t === p || t.startsWith(p));
}

/** True when a cardinality hint indicates a category with many distinct values. */
function isHighCardinality(hint: ResolvedDimension['cardinality']): boolean {
  if (hint === 'high') return true;
  if (typeof hint === 'number') return hint > HIGH_CARDINALITY_THRESHOLD;
  return false;
}

/** Remove the chosen kind from a candidate alternative list (order preserved). */
function without(
  kinds: RecommendedChartKind[],
  chosen: RecommendedChartKind,
): RecommendedChartKind[] {
  return kinds.filter((k) => k !== chosen);
}

/**
 * Recommend a chart kind for a semantic query shape.
 *
 * Heuristics (evaluated top-down; first match wins):
 *  - 1 measure, 0 dims                     → kpi     ("single value")
 *  - 2 measures, 0 dims                    → scatter ("correlation")
 *  - 1 time dim + ≥1 measure               → line    ("trend over time")
 *  - 1 low-card categorical + ≥1 measure   → bar     ("comparison")
 *  - 1 high-card categorical + ≥1 measure  → bar     ("sorted bar; pies fail past ~5 slices")
 *  - 2 dims + ≥1 measure                   → heatmap ("matrix")
 *  - everything else                       → table
 */
export function recommendChartKind(
  query: SemanticQuery,
  resolvedDefs: ResolvedDefinitions,
): ChartRecommendation {
  const dims = query.dimensions ?? [];
  const measures = query.measures ?? [];
  const dimCount = dims.length;
  const measureCount = measures.length;

  const timeDimCount = dims.filter((d) =>
    isTimeDimensionType(resolvedDefs.dimensions[d.dimensionId]?.type),
  ).length;

  // ── No dimensions ─────────────────────────────────────────────────────────
  if (dimCount === 0) {
    if (measureCount === 1) {
      return {
        chartKind: 'kpi',
        rationale: '1 measure, no dimensions = a single value shown as a big-number KPI.',
        alternatives: ['bar', 'table'],
      };
    }
    if (measureCount === 2) {
      return {
        chartKind: 'scatter',
        rationale: '2 measures, no dimensions = scatter to reveal correlation between them.',
        alternatives: ['table'],
      };
    }
    // 0 measures, or 3+ measures with no dimension → nothing meaningful to plot.
    return {
      chartKind: 'table',
      rationale:
        measureCount === 0
          ? 'No dimensions or measures selected = table.'
          : `${measureCount} measures with no dimension = table (no axis to plot against).`,
      alternatives: [],
    };
  }

  // ── Dimensions present but no measure → nothing to aggregate ────────────────
  if (measureCount === 0) {
    return {
      chartKind: 'table',
      rationale: `${dimCount} dimension(s) but no measure = table (nothing to aggregate).`,
      alternatives: [],
    };
  }

  // ── Exactly one dimension ───────────────────────────────────────────────────
  if (dimCount === 1) {
    const dimDef = resolvedDefs.dimensions[dims[0].dimensionId];

    if (timeDimCount === 1) {
      return {
        chartKind: 'line',
        rationale: '1 time dimension + measure = trend over time.',
        alternatives: without(['bar', 'scatter', 'table'], 'line'),
      };
    }

    if (isHighCardinality(dimDef?.cardinality)) {
      return {
        chartKind: 'bar',
        rationale:
          'High-cardinality category + measure = sorted bar (pies become unreadable past ~5 slices).',
        alternatives: without(['table', 'line'], 'bar'),
      };
    }

    return {
      chartKind: 'bar',
      rationale: '1 category + measure = bar for comparison.',
      alternatives: without(['line', 'pie', 'table'], 'bar'),
    };
  }

  // ── Exactly two dimensions ──────────────────────────────────────────────────
  if (dimCount === 2) {
    return {
      chartKind: 'heatmap',
      rationale: '2 dimensions + measure = heatmap (a value matrix); grouped bar also works.',
      alternatives: without(['bar', 'line', 'table'], 'heatmap'),
    };
  }

  // ── Three or more dimensions → fall back to a table ─────────────────────────
  return {
    chartKind: 'table',
    rationale: `${dimCount} dimensions + measure = table (too many axes for a single chart).`,
    alternatives: ['bar', 'heatmap'],
  };
}

/**
 * Map a recommended kind to WidgetSpec['chartKind'] (the ChartSpec['kind']
 * subset). 'pie' → 'donut', 'table' → 'bar' (nearest renderable equivalent;
 * the builder has no first-class table widget).
 */
export function recommendedKindToWidgetKind(
  kind: RecommendedChartKind,
): 'kpi' | 'bar' | 'line' | 'donut' | 'scatter' | 'heatmap' | 'histogram' {
  switch (kind) {
    case 'pie':
      return 'donut';
    case 'table':
      return 'bar';
    case 'line':
    case 'bar':
    case 'scatter':
    case 'kpi':
    case 'heatmap':
      return kind;
    default:
      return 'bar';
  }
}
