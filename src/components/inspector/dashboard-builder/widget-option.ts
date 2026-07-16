/**
 * src/components/inspector/dashboard-builder/widget-option.ts
 *
 * Pure WidgetSpec → ChartSpec / ECharts-option mapping for dashboard widget
 * previews. No React, no ECharts imports — just data shaping — so it is unit
 * testable in isolation (see __tests__/widget-option.test.ts).
 *
 * §4.5 GOTCHA: result rows are keyed by the compiler's snake_case alias
 * (toAlias(label)), NOT by the human definition label. Every column lookup
 * here goes through toAlias(). Reading row[label] directly yields undefined —
 * a chart with correct axes and silently-empty series, visually identical to
 * the "PREVIEW — NO DATA" placeholder. That is the bug this module and its
 * tests exist to prevent.
 */

import type { WidgetSpec } from '@/lib/dashboards/types';
import type { ChartSpec } from '@/lib/studio/types';
import { toAlias } from '@/lib/semantic/compiler';

export type DefinitionMap = Map<
  string,
  { label: string; status: string; aggregate?: string; expression?: string | null; metric_type?: string }
>;

/** One rendered series: its human name (legend) + the aliased column to read. */
export interface SeriesResolution {
  name: string;
  alias: string;
}

export interface PreviewMapping {
  /** toAlias of each dimension label, in query order. dimAliases[0] = x axis. */
  dimAliases: string[];
  /** One entry per measure — its legend name and the aliased column to read. */
  series: SeriesResolution[];
  rows?: Record<string, unknown>[];
}

/**
 * Convert a WidgetSpec + live definitions (+ optional executed rows) into a
 * ChartSpec that StudioChart can render. Returns null if there isn't enough
 * information to render a meaningful chart.
 */
export function widgetToChartSpec(
  widget: WidgetSpec,
  definitions: DefinitionMap,
  rows?: Record<string, unknown>[],
): ChartSpec | null {
  const { chartKind, chartConfig, semanticQuery, title } = widget;

  const xLabel = chartConfig.x ?? resolveFirstDimLabel(semanticQuery, definitions);
  const yLabels = chartConfig.y ?? resolveAllMeasureLabels(semanticQuery, definitions);

  if (!xLabel && chartKind !== 'kpi') return null;
  if (yLabels.length === 0 && chartKind !== 'kpi') return null;

  // Row-lookup aliases come from the DEFINITION LABELS via toAlias — this is
  // what the compiler used to key result columns. Never from chartConfig.x/y
  // (which can be column IDs) or from the raw label.
  const dimAliases = semanticQuery.dimensions.map((d) =>
    toAlias(definitions.get(d.dimensionId)?.label ?? d.dimensionId),
  );
  const series: SeriesResolution[] = semanticQuery.measures.map((m) => {
    const label = definitions.get(m.measureId)?.label ?? m.measureId.slice(-6);
    return { name: label, alias: toAlias(label) };
  });

  if (chartKind === 'kpi') {
    const measureLabel = series[0]?.name ?? yLabels[0] ?? 'Value';
    const alias = series[0]?.alias ?? null;
    const value = rows && rows.length > 0 && alias ? rows[0][alias] : undefined;
    return {
      id: widget.widgetId,
      kind: 'kpi',
      title: measureLabel,
      rationale: title,
      echartsOption: buildKpiOption(measureLabel, value),
      rank: 0,
      alternatives: [],
    };
  }

  const echartsOption = buildPreviewOption(chartKind, xLabel, yLabels, {
    dimAliases,
    series,
    rows,
  });

  return {
    id: widget.widgetId,
    kind: chartKind,
    title,
    rationale: `${chartKind} · ${xLabel} × ${yLabels.join(', ')}`,
    x: xLabel ?? undefined,
    y: yLabels,
    series: chartConfig.series ?? undefined,
    value: chartConfig.value ?? undefined,
    echartsOption,
    rank: 0,
    alternatives: [],
  };
}

export function resolveFirstDimLabel(
  sq: WidgetSpec['semanticQuery'],
  defs: DefinitionMap,
): string | null {
  if (sq.dimensions.length === 0) return null;
  const def = defs.get(sq.dimensions[0].dimensionId);
  return def?.label ?? sq.dimensions[0].dimensionId.slice(-6);
}

export function resolveAllMeasureLabels(
  sq: WidgetSpec['semanticQuery'],
  defs: DefinitionMap,
): string[] {
  return sq.measures.map((m) => {
    const def = defs.get(m.measureId);
    return def?.label ?? m.measureId.slice(-6);
  });
}

/** Map a widget chartKind to the ECharts series type. */
export function echartsSeriesType(kind: string): string {
  if (kind === 'donut') return 'pie';
  if (kind === 'scatter') return 'scatter';
  if (kind === 'histogram') return 'bar';
  return kind; // 'bar' | 'line' | 'heatmap'
}

/**
 * Build the ECharts option for a widget preview.
 *
 * No rows → the original placeholder: empty series + "PREVIEW — NO DATA"
 * overlay (behaviour intentionally unchanged from the builder's live preview).
 * With rows → series filled from the aliased result columns, overlay dropped.
 */
export function buildPreviewOption(
  kind: string,
  xLabel: string | null,
  yLabels: string[],
  mapping: PreviewMapping,
): Record<string, unknown> {
  const { dimAliases, series, rows } = mapping;
  const hasData = Array.isArray(rows) && rows.length > 0;
  const xAlias = dimAliases[0] ?? null;
  const yAlias = dimAliases[1] ?? null; // heatmap second axis

  // Heatmap needs [xIdx, yIdx, value] + category axes; only meaningful with two
  // dimensions. Otherwise degrade to a bar so we never emit a broken heatmap.
  if (kind === 'heatmap' && xAlias && yAlias && series[0]) {
    return buildHeatmapOption(xLabel, yLabels[0] ?? '', xAlias, yAlias, series[0].alias, rows);
  }
  const effectiveType = kind === 'heatmap' ? 'bar' : echartsSeriesType(kind);

  const categories = hasData && xAlias ? rows!.map((r) => r[xAlias]) : [];

  const seriesArr = series.map((s) => {
    let data: unknown[] = [];
    if (hasData) {
      if (kind === 'donut') {
        data = rows!.map((r) => ({
          name: xAlias ? String(r[xAlias] ?? '') : s.name,
          value: r[s.alias] ?? null,
        }));
      } else if (kind === 'scatter') {
        data = rows!.map((r) => [xAlias ? r[xAlias] : null, r[s.alias] ?? null]);
      } else {
        data = rows!.map((r) => r[s.alias] ?? null);
      }
    }
    return { name: s.name, type: effectiveType, data };
  });

  const baseOption: Record<string, unknown> = {
    animation: false,
    grid: { left: 40, right: 16, top: 24, bottom: 32 },
    xAxis: {
      type: kind === 'scatter' ? 'value' : 'category',
      name: xLabel ?? '',
      nameTextStyle: { fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
      data: categories,
    },
    yAxis: {
      type: 'value',
      name: yLabels[0] ?? '',
      nameTextStyle: { fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
    },
    series: seriesArr,
  };

  // Donut/pie ignore the cartesian axes.
  if (kind === 'donut') {
    delete baseOption.xAxis;
    delete baseOption.yAxis;
    delete baseOption.grid;
  }

  if (!hasData) {
    baseOption.graphic = {
      elements: [
        {
          type: 'text',
          style: {
            text: 'PREVIEW — NO DATA',
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
            fill: '#8892A4',
          },
          left: 'center',
          top: 'center',
        },
      ],
    };
  }

  return baseOption;
}

/** Two-dimension heatmap: category axes + [xIdx, yIdx, value] cells. */
export function buildHeatmapOption(
  xLabel: string | null,
  yLabel: string,
  xAlias: string,
  yAlias: string,
  valueAlias: string,
  rows?: Record<string, unknown>[],
): Record<string, unknown> {
  const hasData = Array.isArray(rows) && rows.length > 0;

  if (!hasData) {
    return {
      animation: false,
      xAxis: { type: 'category', data: [], name: xLabel ?? '' },
      yAxis: { type: 'category', data: [], name: yLabel },
      series: [{ type: 'heatmap', data: [] }],
      graphic: {
        elements: [
          {
            type: 'text',
            style: { text: 'PREVIEW — NO DATA', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", fill: '#8892A4' },
            left: 'center',
            top: 'center',
          },
        ],
      },
    };
  }

  const xCats = uniqueStrings(rows!.map((r) => String(r[xAlias] ?? '')));
  const yCats = uniqueStrings(rows!.map((r) => String(r[yAlias] ?? '')));
  const xIndex = new Map(xCats.map((v, i) => [v, i]));
  const yIndex = new Map(yCats.map((v, i) => [v, i]));

  const data = rows!.map((r) => {
    const rawVal = r[valueAlias];
    const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
    return [
      xIndex.get(String(r[xAlias] ?? '')) ?? 0,
      yIndex.get(String(r[yAlias] ?? '')) ?? 0,
      Number.isFinite(num) ? num : 0,
    ];
  });

  const values = data.map((d) => d[2] as number);

  return {
    animation: false,
    grid: { left: 60, right: 16, top: 24, bottom: 40 },
    xAxis: { type: 'category', data: xCats, name: xLabel ?? '' },
    yAxis: { type: 'category', data: yCats, name: yLabel },
    visualMap: {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
    },
    series: [{ type: 'heatmap', data }],
  };
}

/** KPI / big-number: a single scalar rendered as centred graphic text. */
export function buildKpiOption(label: string, value: unknown): Record<string, unknown> {
  const display =
    value === undefined || value === null
      ? '—'
      : typeof value === 'number'
        ? formatNumber(value)
        : String(value);

  return {
    animation: false,
    graphic: {
      elements: [
        {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: display, fontSize: 34, fontFamily: "'IBM Plex Mono', monospace", fill: '#F0F4F8', fontWeight: 600 },
        },
        {
          type: 'text',
          left: 'center',
          top: '68%',
          style: { text: label.toUpperCase(), fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", fill: '#8892A4' },
        },
      ],
    },
  };
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
