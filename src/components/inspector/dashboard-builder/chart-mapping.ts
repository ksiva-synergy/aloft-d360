/**
 * src/components/inspector/dashboard-builder/chart-mapping.ts
 *
 * Pure ChartDSLSpec → WidgetSpec mapping shared by the two "chart becomes a
 * widget" surfaces:
 *   - DefinitionPicker "Charts" tab copy (DashboardBuilder.handleAddChart)
 *   - "Pin to dashboard" (PinToDashboardDialog)
 *
 * No React / DOM / network here — just data shaping — so the mapping is unit
 * testable in isolation (see __tests__/chart-mapping.test.ts).
 *
 * Provenance: buildWidgetSpecFromChart stamps `source_chart_id` so the widget
 * carries a lineage back-reference to its platform_charts row. This is
 * NON-authoritative (memory doc §2.3): it never drives drift detection and a
 * dangling reference is expected, not an error.
 *
 * measureSnapshots is intentionally emitted EMPTY — the version-save route
 * (POST /dashboards/[id]/versions) recomputes snapshots server-side from live
 * definitions and overwrites whatever the client sends (invariant §8: never
 * trust client-supplied snapshots).
 */

import type { WidgetSpec } from '@/lib/dashboards/types';
import type { SemanticQuery } from '@/lib/semantic/types';
import type { ChartDSLSpec } from '@/lib/studio/chart-dsl';

/**
 * Map a ChartDSLSpec.kind to WidgetSpec's chartKind (the ChartSpec['kind']
 * subset). DSL kinds without a first-class WidgetSpec equivalent are downgraded
 * to the nearest kind; visual intent for the downgrade is preserved via
 * echartsOption in encodingsToChartConfig.
 */
export function dslKindToWidgetKind(kind: string): WidgetSpec['chartKind'] {
  switch (kind) {
    case 'bar':         return 'bar';
    case 'stacked-bar': return 'bar';   // downgrade: stack config preserved in echartsOption
    case 'line':        return 'line';
    case 'area':        return 'line';  // downgrade: area fill in echartsOption
    case 'pie':         return 'donut'; // closest match
    case 'scatter':     return 'scatter';
    case 'heatmap':     return 'heatmap';
    case 'histogram':   return 'histogram';
    case 'boxplot':     return 'bar';   // fallback: no boxplot kind in WidgetSpec
    default:            return 'bar';
  }
}

/**
 * Convert ChartDSLSpec encodings to WidgetSpec.chartConfig axis slots and
 * preserve ECharts overrides for downgraded kinds (stacked-bar, area).
 */
export function encodingsToChartConfig(dsl: ChartDSLSpec): WidgetSpec['chartConfig'] {
  const xEnc   = dsl.encodings.find((e) => e.role === 'x');
  const yEncs  = dsl.encodings.filter((e) => e.role === 'y');
  const series = dsl.encodings.find((e) => e.role === 'series');
  const value  = dsl.encodings.find((e) => e.role === 'value');

  const config: WidgetSpec['chartConfig'] = {
    x:      xEnc?.columnId,
    y:      yEncs.length ? yEncs.map((e) => e.columnId) : undefined,
    series: series?.columnId,
    value:  value?.columnId,
  };

  if (dsl.kind === 'stacked-bar') {
    config.echartsOption = { series: [{ stack: 'total' }] };
  } else if (dsl.kind === 'area') {
    config.echartsOption = { series: [{ areaStyle: {} }] };
  }

  return config;
}

export interface BuildWidgetSpecInput {
  /** cuid2 assigned by the caller (client-side createId). */
  widgetId: string;
  /** Widget display title (pin dialog pre-fills from the chart title). */
  title: string;
  chartDsl: ChartDSLSpec;
  semanticQuery: SemanticQuery;
  /** platform_charts row id — recorded as the widget's provenance reference. */
  sourceChartId: string;
  /** Grid placement; caller computes an open slot. */
  position: WidgetSpec['position'];
}

/**
 * Build a fresh WidgetSpec from a saved/semantic chart, tagged with its source
 * chart id. Emits empty measureSnapshots (server re-freezes at save) and no
 * freshness (defaults to 'live').
 */
export function buildWidgetSpecFromChart(input: BuildWidgetSpecInput): WidgetSpec {
  return {
    widgetId: input.widgetId,
    title: input.title,
    chartKind: dslKindToWidgetKind(input.chartDsl.kind),
    semanticQuery: input.semanticQuery,
    measureSnapshots: [],
    chartConfig: encodingsToChartConfig(input.chartDsl),
    position: input.position,
    source_chart_id: input.sourceChartId,
  };
}
