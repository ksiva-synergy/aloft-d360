/**
 * src/lib/dashboards/raw-sql-chart.ts
 *
 * Pure helpers for Phase 3.5C raw-SQL escape-hatch charts. No React / DOM /
 * network / Prisma — just data shaping — so every branch is unit-testable
 * (see __tests__/raw-sql-chart.test.ts).
 *
 * A raw-SQL chart is authored in the Inspector ad-hoc SQL path (DashboardPane's
 * ChartBuilder). Its config is a small DSL frozen into platform_charts.chart_dsl
 * and, when pinned, into a RawSqlWidgetSpec. Unlike the semantic ChartDSLSpec,
 * the axis fields hold the SQL's ACTUAL result column names — the widget mapper
 * binds row[columnName] directly, never through toAlias().
 */

import type { RawSqlWidgetSpec, WidgetSpec } from './types';

/** Renderable chart kinds the ad-hoc ChartBuilder can produce (excludes 'table'). */
export type RawChartKind = 'bar' | 'line' | 'area' | 'pie' | 'scatter';

/**
 * The chart_dsl shape stored for a raw-SQL chart. `x` / `y` are real SQL result
 * column names. `source: 'raw_sql'` distinguishes it from a semantic ChartDSLSpec
 * at read time (both live in platform_charts.chart_dsl).
 */
export interface RawSqlChartDsl {
  source: 'raw_sql';
  kind: RawChartKind;
  /** X-axis / category column (a real result column name). */
  x: string;
  /** One or more Y-axis / value columns (real result column names). */
  y: string[];
}

/** Type guard: is this chart_dsl a raw-SQL DSL (vs a semantic ChartDSLSpec)? */
export function isRawSqlChartDsl(dsl: unknown): dsl is RawSqlChartDsl {
  return (
    typeof dsl === 'object' &&
    dsl !== null &&
    (dsl as { source?: unknown }).source === 'raw_sql'
  );
}

/**
 * Map a raw ChartBuilder kind to the WidgetSpec chartKind subset. `area` renders
 * as a line (with an area fill echarts override); `pie` maps to `donut` (the
 * nearest WidgetSpec kind). Everything else is 1:1.
 */
export function rawKindToWidgetKind(kind: RawChartKind): WidgetSpec['chartKind'] {
  switch (kind) {
    case 'bar':     return 'bar';
    case 'line':    return 'line';
    case 'area':    return 'line';   // area fill preserved via echartsOption
    case 'pie':     return 'donut';  // closest WidgetSpec kind
    case 'scatter': return 'scatter';
    default:        return 'bar';
  }
}

/**
 * Convert a RawSqlChartDsl into a WidgetSpec.chartConfig. The axis columns pass
 * through verbatim (they are the real result column names the mapper reads). An
 * `area` kind keeps its fill through an echartsOption override, mirroring the
 * semantic chart-mapping downgrade.
 */
export function rawDslToChartConfig(dsl: RawSqlChartDsl): WidgetSpec['chartConfig'] {
  const config: WidgetSpec['chartConfig'] = {
    x: dsl.x || undefined,
    y: dsl.y.length ? [...dsl.y] : undefined,
  };
  if (dsl.kind === 'area') {
    config.echartsOption = { series: [{ areaStyle: {} }] };
  }
  return config;
}

export interface BuildRawSqlWidgetSpecInput {
  /** cuid2 assigned by the caller. */
  widgetId: string;
  title: string;
  rawSql: string;
  resultSchema: { name: string; type: string }[];
  connectionId: string;
  dsl: RawSqlChartDsl;
  position: WidgetSpec['position'];
  /** platform_charts row id — recorded as provenance (optional). */
  sourceChartId?: string;
}

/**
 * Build a RawSqlWidgetSpec from a saved/ad-hoc raw-SQL chart. Carries the frozen
 * SQL, result schema, and its own connection. Emits NO semanticQuery and NO
 * measureSnapshots — those have no meaning here and are absent by type.
 */
export function buildRawSqlWidgetSpec(input: BuildRawSqlWidgetSpecInput): RawSqlWidgetSpec {
  return {
    chartSource: 'raw_sql',
    widgetId: input.widgetId,
    title: input.title,
    chartKind: rawKindToWidgetKind(input.dsl.kind),
    chartConfig: rawDslToChartConfig(input.dsl),
    position: input.position,
    rawSql: input.rawSql,
    resultSchema: input.resultSchema,
    connectionId: input.connectionId,
    ...(input.sourceChartId ? { source_chart_id: input.sourceChartId } : {}),
  };
}
