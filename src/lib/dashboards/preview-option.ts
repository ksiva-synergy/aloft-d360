/**
 * src/lib/dashboards/preview-option.ts
 *
 * PURE RowsToOptionResult → ECharts option for the guided preview surfaces
 * (SamplePreviewChart). No React, no ECharts import, no I/O — so the toAlias
 * binding guard can assert on the produced option in isolation, and so sample
 * mode and live mode share exactly one builder.
 *
 * §4.5 GOTCHA GUARD SEAM: the series `data` arrays are passed through VERBATIM
 * from the mapped `RowsToOptionResult`. That result is produced upstream by
 * rows-to-option.ts, which keys row lookups by `toAlias(label)`. If that mapping
 * is wrong (rows keyed by the raw label), the series arrive here as all-null and
 * this builder faithfully emits an all-null series — the silent empty-series
 * false-green. preview-option.toalias.test.ts asserts both halves: real numbers
 * bind when rows are toAlias-keyed, and only nulls bind when they are not.
 */

import type { RowsToOptionResult } from './rows-to-option';
import {
  colorForMeasure,
  CATEGORICAL,
  OKABE_ITO_OTHER,
  VIRIDIS,
  UI_FONT,
  INK_MUTED,
} from './inspector-viz-tokens';

/** Superset of ChartKindGuess and WidgetSpec['chartKind'] — normalised by canon(). */
export type PreviewChartKind =
  | 'line' | 'bar' | 'scatter' | 'kpi' | 'pie' | 'donut' | 'heatmap' | 'histogram' | 'table';

export type CanonKind = 'bar' | 'line' | 'scatter' | 'kpi' | 'pie' | 'heatmap' | 'table';

export function canon(kind: PreviewChartKind): CanonKind {
  switch (kind) {
    case 'donut': return 'pie';
    case 'histogram': return 'bar';
    case 'bar': case 'line': case 'scatter': case 'kpi': case 'pie': case 'heatmap': case 'table':
      return kind;
    default: return 'bar';
  }
}

export interface BuildOptionOpts {
  inkColor: string;
  /** Series identities in query order — drive colorForMeasure (identity encoding). */
  seriesIdentities: string[];
}

/** Compact axis number formatter — keeps small tiles readable. */
function compactNum(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

/**
 * RowsToOptionResult → ECharts option. The only colour set inline is the
 * per-series identity encoding (`colorForMeasure`), so the SAME metric is the
 * SAME hue regardless of series order; everything else rides the registered
 * inspector theme.
 */
export function buildPreviewOption(
  kind: PreviewChartKind,
  result: RowsToOptionResult,
  opts: BuildOptionOpts,
): Record<string, unknown> {
  const k = canon(kind);
  const { inkColor, seriesIdentities } = opts;
  const { categories, series } = result;
  const seriesColors = series.map((s, i) => colorForMeasure(seriesIdentities[i] ?? s.name));

  if (k === 'kpi') {
    const value = series[0]?.data?.[0];
    const label = series[0]?.name ?? '';
    return {
      animation: false,
      graphic: {
        elements: [
          { type: 'text', left: 'center', top: '42%', style: { text: formatValue(value), fontSize: 34, fontFamily: UI_FONT, fill: seriesColors[0] ?? inkColor, fontWeight: 700 } },
          { type: 'text', left: 'center', top: '62%', style: { text: label, fontSize: 11, fontFamily: UI_FONT, fill: INK_MUTED } },
        ],
      },
    };
  }

  if (k === 'pie') {
    const s0 = series[0];
    const raw = categories.map((c, i) => ({ name: String(c), value: toNum(s0?.data?.[i]) }));
    const capped = capSlices(raw, 6);
    return {
      animation: false,
      color: [...CATEGORICAL, OKABE_ITO_OTHER],
      series: [{
        type: 'pie',
        radius: ['42%', '70%'],
        data: capped,
        // No external labels — they overflow small tiles; tooltip/hover reveals detail.
        label: { show: false },
        labelLine: { show: false },
        emphasis: { label: { show: true, color: inkColor, fontFamily: UI_FONT, fontSize: 11 } },
      }],
    };
  }

  if (k === 'heatmap') {
    const cells: [number, number, number][] = [];
    let min = Infinity, max = -Infinity;
    series.forEach((s, yi) => {
      categories.forEach((_, xi) => {
        const v = toNum(s.data?.[xi]);
        cells.push([xi, yi, v]);
        if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
      });
    });
    return {
      animation: false,
      grid: { containLabel: true, left: 12, right: 80, top: 28, bottom: 8 },
      xAxis: { type: 'category', data: categories.map(String), axisLabel: { fontSize: 10, interval: 0, overflow: 'truncate', width: 60 } },
      yAxis: { type: 'category', data: series.map((s) => s.name), axisLabel: { fontSize: 10 } },
      visualMap: {
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 1,
        calculable: true,
        orient: 'vertical',
        right: 0,
        top: 'center',
        itemHeight: 80,
        inRange: { color: [...VIRIDIS] },
      },
      series: [{ type: 'heatmap', data: cells }],
    };
  }

  if (k === 'scatter') {
    const seriesArr =
      series.length >= 2
        ? [{ type: 'scatter', color: seriesColors[0], data: series[0].data.map((d, i) => [toNum(d), toNum(series[1].data?.[i])]) }]
        : series.map((s, i) => ({ name: s.name, type: 'scatter', color: seriesColors[i], data: s.data.map((d, xi) => [xi, toNum(d)]) }));
    return {
      animation: false,
      grid: { containLabel: true, left: 12, right: 12, top: 28, bottom: 8 },
      xAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: compactNum } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: compactNum } },
      series: seriesArr,
    };
  }

  // bar / line — series data passed through verbatim (the guard seam).
  const type = k === 'line' ? 'line' : 'bar';
  const catCount = categories.length;
  return {
    animation: false,
    color: seriesColors,
    grid: {
      containLabel: true,  // labels stay inside the card — no overflow/scrollbar illusion
      left: 12,
      right: 12,
      top: 28,             // clearance for the "Sample data" chip
      bottom: 8,
    },
    legend: series.length > 1
      ? { show: true, bottom: 0, textStyle: { color: INK_MUTED, fontFamily: UI_FONT, fontSize: 10 } }
      : { show: false },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: categories.map(String),
      axisLabel: {
        fontSize: 10,
        interval: 0,
        rotate: catCount > 5 ? 35 : 0,
        overflow: 'truncate',
        width: catCount > 5 ? 55 : 80,
      },
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, formatter: compactNum },
    },
    series: series.map((s) => ({
      name: s.name,
      type,
      data: s.data,
      barMaxWidth: 40,
      ...(type === 'line' ? { areaStyle: { opacity: 0.08 }, smooth: 0.3 } : {}),
    })),
  };
}

// ── pure display helpers (shared with the component) ──────────────────────────

export function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

export function formatValue(v: unknown): string {
  const n = toNum(v);
  if (!Number.isFinite(n)) return v == null ? '—' : String(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function capSlices(data: { name: string; value: number }[], cap: number): { name: string; value: number }[] {
  if (data.length <= cap) return data;
  const head = data.slice(0, cap - 1);
  const other = data.slice(cap - 1).reduce((sum, d) => sum + (Number.isFinite(d.value) ? d.value : 0), 0);
  return [...head, { name: 'Other', value: other }];
}
