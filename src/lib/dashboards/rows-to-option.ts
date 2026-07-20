/**
 * src/lib/dashboards/rows-to-option.ts
 *
 * Pure rows → chart-mapping for the guided drill-in live preview (issue #2,
 * DATA-3). No React, no ECharts, no I/O — just data shaping — so the shell's
 * WidgetPreview component can call it at integration WITHOUT this track ever
 * touching a shell-owned file, and so the false-green gotcha below can be
 * caught in isolation.
 *
 * ── THE GOTCHA this module exists to prevent (memory §4.5 / TIP §2.2) ─────────
 * Semantic result rows are keyed by the COMPILER'S snake_case alias
 * (`toAlias(label)`), NOT by the human definition label:
 *
 *     const col = toAlias(measure.label);   // "Total Revenue" -> "total_revenue"
 *     const data = rows.map(r => r[col]);   // ✅  NOT rows.map(r => r[measure.label])
 *
 * Read `row[label]` and every value is `undefined` → a chart with correct axes
 * and silently-empty series, visually identical to the old "no data"
 * placeholder. rows-to-option.test.ts asserts exactly this.
 *
 * ── Divergence from the DSL chart pipeline ───────────────────────────────────
 * This is deliberately NOT `lib/semantic/chart-pipeline.ts`. Widgets store a
 * flat `chartConfig` (x / y / series), not a full chart DSL. Raw-SQL widgets
 * key rows by their real result column names (no aliasing) and are handled by
 * widget-option.ts, not here — this mapper is the semantic-widget path only.
 *
 * ── Empty is DISTINGUISHABLE, not rendered ───────────────────────────────────
 * A genuinely empty result (`rows: []`) yields `isEmpty: true` with empty
 * series `data`, so the shell can render its own empty branch. The
 * empty-vs-not-wired *rendering* is the shell's; this mapper only guarantees the
 * two are distinguishable in its output.
 *
 * ── Measure unit/format (issue #2, Task 6) ───────────────────────────────────
 * `unit` / `format` ride on the resolved measure metadata (sourced from
 * `platform_sem_measures.unit` / `.format_hint`) and are surfaced per-series
 * here rather than baked into an ECharts option — baking makes them unreadable
 * to anything but the chart (tooltips, KPI formatting, the trust panel).
 */

import { toAlias } from '@/lib/semantic/compiler';
import type { WidgetSpecBase } from './types';

/** Chart kinds a semantic widget can be — mirrors WidgetSpec.chartKind. */
export type ChartKind = WidgetSpecBase['chartKind'];

/** Resolved measure metadata the mapper needs — label drives the row key. */
export interface MeasureMeta {
  measureId: string;
  /** Human label. `toAlias(label)` is the actual result-row key. */
  label: string;
  /** platform_sem_measures.unit (e.g. '%', 'USD'). Metadata, never baked in. */
  unit?: string | null;
  /** platform_sem_measures.format_hint (e.g. 'currency', 'percent'). */
  format?: string | null;
}

/** Resolved dimension metadata — label drives the axis-category row key. */
export interface DimensionMeta {
  dimensionId: string;
  label: string;
}

export interface RowsToOptionInput {
  chartKind: ChartKind;
  /** In query order; dimensions[0] is the primary (x / category) axis. */
  dimensions: DimensionMeta[];
  /** In query order; one rendered series each. */
  measures: MeasureMeta[];
  /** Executed result rows, keyed by `toAlias(label)`. `[]` for an empty result. */
  rows: Record<string, unknown>[];
}

/** One resolved series: legend name + the aliased column actually read. */
export interface SeriesResolution {
  measureId: string;
  /** Legend / human name. */
  name: string;
  /** `toAlias(label)` — the key read out of each row. THE gotcha guard. */
  alias: string;
  /** Values, pulled via `row[alias]`. Empty array when the result is empty. */
  data: unknown[];
  /** Measure unit metadata (Task 6) — surfaced, not baked into an option. */
  unit: string | null;
  /** Measure format-hint metadata (Task 6). */
  format: string | null;
}

export interface RowsToOptionResult {
  /**
   * True when there were no rows to map. Distinct from "not wired": a wired,
   * executed, zero-row query is `isEmpty: true` with resolved (but empty)
   * series — the shell renders an empty state, not a blank placeholder.
   */
  isEmpty: boolean;
  /** x-axis / category values, from `toAlias(dimensions[0].label)`. */
  categories: unknown[];
  /** `toAlias` of each dimension label, in query order. dimAliases[0] = x. */
  dimAliases: string[];
  /** One entry per measure, keyed by alias — never by raw label. */
  series: SeriesResolution[];
}

/**
 * Map executed semantic rows into a resolved, chart-agnostic mapping. Pure and
 * total: an empty result is a first-class distinguishable output, not null.
 */
export function rowsToOption(input: RowsToOptionInput): RowsToOptionResult {
  const { dimensions, measures, rows } = input;

  const isEmpty = !Array.isArray(rows) || rows.length === 0;

  // Row-lookup keys come from the definition LABELS via toAlias — this is what
  // the compiler used to key result columns. NEVER the raw label.
  const dimAliases = dimensions.map((d) => toAlias(d.label));
  const xAlias = dimAliases[0] ?? null;

  const categories = !isEmpty && xAlias ? rows.map((r) => r[xAlias]) : [];

  const series: SeriesResolution[] = measures.map((m) => {
    const alias = toAlias(m.label); // ← the gotcha: alias, not m.label
    const data = isEmpty ? [] : rows.map((r) => r[alias] ?? null);
    return {
      measureId: m.measureId,
      name: m.label,
      alias,
      data,
      unit: m.unit ?? null,
      format: m.format ?? null,
    };
  });

  return { isEmpty, categories, dimAliases, series };
}
