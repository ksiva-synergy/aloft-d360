import { toAlias } from '../../../../lib/semantic/compiler';
import {
  buildPreviewOption,
  buildKpiOption,
  widgetToChartSpec,
  type DefinitionMap,
} from '../widget-option';
import type { WidgetSpec } from '../../../../lib/dashboards/types';

// ── §4.5 — the silent-failure guard ────────────────────────────────────────────
// Result rows are keyed by the compiler's snake_case alias, NOT the human label.
// Looking up row[label] yields undefined → correct axes with empty series, which
// is visually identical to the "PREVIEW — NO DATA" placeholder. These tests lock
// the alias contract so that regression can never ship silently.
describe('toAlias column resolution', () => {
  it('resolves a measure column via toAlias, never via the raw label', () => {
    const label = 'Total Revenue';
    const alias = toAlias(label);
    expect(alias).toBe('total_revenue');

    const row: Record<string, unknown> = { total_revenue: 42 };
    expect(row[alias]).toBe(42);
    // The bug we are guarding against: reading by the human label.
    expect(row[label]).toBeUndefined();
  });

  it('strips punctuation and collapses separators consistently', () => {
    expect(toAlias('Avg. Order Value ($)')).toBe('avg_order_value');
    expect(toAlias('Order Date')).toBe('order_date');
  });
});

// ── buildPreviewOption — placeholder vs. live data ─────────────────────────────
describe('buildPreviewOption', () => {
  const mapping = {
    dimAliases: [toAlias('Order Month')],
    series: [{ name: 'Total Revenue', alias: toAlias('Total Revenue') }],
  };

  it('keeps the empty-series + PREVIEW overlay when no rows are provided', () => {
    const option = buildPreviewOption('bar', 'Order Month', ['Total Revenue'], mapping);
    const series = option.series as Array<{ data: unknown[] }>;
    expect(series[0].data).toEqual([]);
    expect(option.graphic).toBeDefined();
  });

  it('fills series from aliased columns and drops the overlay when rows are provided', () => {
    const rows = [
      { order_month: '2026-01', total_revenue: 100 },
      { order_month: '2026-02', total_revenue: 150 },
    ];
    const option = buildPreviewOption('bar', 'Order Month', ['Total Revenue'], { ...mapping, rows });

    const series = option.series as Array<{ name: string; data: unknown[] }>;
    expect(series[0].data).toEqual([100, 150]);
    expect(series[0].data.length).toBeGreaterThan(0);
    // Category axis is filled from the dimension alias.
    expect((option.xAxis as { data: unknown[] }).data).toEqual(['2026-01', '2026-02']);
    // No placeholder overlay once real data is present.
    expect(option.graphic).toBeUndefined();
  });

  it('maps donut rows to {name, value} pairs', () => {
    const rows = [
      { region: 'APAC', total_revenue: 100 },
      { region: 'EMEA', total_revenue: 60 },
    ];
    const option = buildPreviewOption('donut', 'Region', ['Total Revenue'], {
      dimAliases: [toAlias('Region')],
      series: [{ name: 'Total Revenue', alias: toAlias('Total Revenue') }],
      rows,
    });
    const series = option.series as Array<{ data: Array<{ name: string; value: unknown }> }>;
    expect(series[0].data).toEqual([
      { name: 'APAC', value: 100 },
      { name: 'EMEA', value: 60 },
    ]);
  });
});

// ── buildKpiOption ─────────────────────────────────────────────────────────────
describe('buildKpiOption', () => {
  it('renders a dash placeholder when the value is missing', () => {
    const option = buildKpiOption('Total Revenue', undefined);
    const text = firstGraphicText(option);
    expect(text).toBe('—');
  });

  it('formats a numeric value', () => {
    const option = buildKpiOption('Total Revenue', 1500);
    const text = firstGraphicText(option);
    expect(text).toBe('1.5K');
  });
});

// ── widgetToChartSpec end-to-end ───────────────────────────────────────────────
describe('widgetToChartSpec', () => {
  const defs: DefinitionMap = new Map([
    ['dim_1', { label: 'Order Month', status: 'active' }],
    ['meas_1', { label: 'Total Revenue', status: 'active' }],
  ]);

  const widget = {
    widgetId: 'w1',
    title: 'Revenue by month',
    chartKind: 'bar',
    semanticQuery: {
      modelId: 'm1',
      entityId: 'e1',
      dimensions: [{ dimensionId: 'dim_1' }],
      measures: [{ measureId: 'meas_1' }],
      filters: [],
      sorts: [],
    },
    measureSnapshots: [],
    chartConfig: {},
    position: { col: 0, row: 0, w: 4, h: 4 },
  } as unknown as WidgetSpec;

  it('produces a filled bar series when rows are provided', () => {
    const rows = [
      { order_month: '2026-01', total_revenue: 100 },
      { order_month: '2026-02', total_revenue: 150 },
    ];
    const spec = widgetToChartSpec(widget, defs, rows);
    expect(spec).not.toBeNull();
    const series = (spec!.echartsOption as { series: Array<{ data: unknown[] }> }).series;
    expect(series[0].data).toEqual([100, 150]);
  });

  it('returns the placeholder overlay when rows are absent', () => {
    const spec = widgetToChartSpec(widget, defs);
    const option = spec!.echartsOption as { series: Array<{ data: unknown[] }>; graphic?: unknown };
    expect(option.series[0].data).toEqual([]);
    expect(option.graphic).toBeDefined();
  });
});

function firstGraphicText(option: Record<string, unknown>): unknown {
  const graphic = option.graphic as { elements: Array<{ style: { text: unknown } }> };
  return graphic.elements[0].style.text;
}
