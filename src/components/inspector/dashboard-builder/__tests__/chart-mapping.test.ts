import {
  dslKindToWidgetKind,
  encodingsToChartConfig,
  buildWidgetSpecFromChart,
} from '../chart-mapping';
import type { ChartDSLSpec } from '../../../../lib/studio/chart-dsl';
import type { SemanticQuery } from '../../../../lib/semantic/types';

const semanticQuery: SemanticQuery = {
  modelId: 'model_a',
  entityId: 'entity_a',
  dimensions: [{ dimensionId: 'dim_month' }],
  measures: [{ measureId: 'meas_revenue' }],
  filters: [],
  sorts: [],
};

const dsl: ChartDSLSpec = {
  id: 'chart_1',
  kind: 'bar',
  title: 'Revenue by Month',
  encodings: [
    { columnId: 'order_month', role: 'x' },
    { columnId: 'total_revenue', role: 'y' },
  ],
};

describe('dslKindToWidgetKind', () => {
  it('maps first-class kinds directly and downgrades the rest', () => {
    expect(dslKindToWidgetKind('bar')).toBe('bar');
    expect(dslKindToWidgetKind('line')).toBe('line');
    expect(dslKindToWidgetKind('pie')).toBe('donut');
    expect(dslKindToWidgetKind('stacked-bar')).toBe('bar');
    expect(dslKindToWidgetKind('area')).toBe('line');
    expect(dslKindToWidgetKind('boxplot')).toBe('bar');
    expect(dslKindToWidgetKind('unknown-kind')).toBe('bar');
  });
});

describe('encodingsToChartConfig', () => {
  it('maps encodings into axis slots', () => {
    const cfg = encodingsToChartConfig(dsl);
    expect(cfg.x).toBe('order_month');
    expect(cfg.y).toEqual(['total_revenue']);
    expect(cfg.echartsOption).toBeUndefined();
  });

  it('injects a stack override for stacked-bar', () => {
    const cfg = encodingsToChartConfig({ ...dsl, kind: 'stacked-bar' });
    expect(cfg.echartsOption).toEqual({ series: [{ stack: 'total' }] });
  });
});

describe('buildWidgetSpecFromChart', () => {
  it('stamps source_chart_id and leaves measureSnapshots empty for server recompute', () => {
    const widget = buildWidgetSpecFromChart({
      widgetId: 'w1',
      title: 'My Widget',
      chartDsl: dsl,
      semanticQuery,
      sourceChartId: 'chart_1',
      position: { col: 0, row: 0, w: 6, h: 4 },
    });

    expect(widget.widgetId).toBe('w1');
    expect(widget.title).toBe('My Widget');
    expect(widget.chartKind).toBe('bar');
    expect(widget.semanticQuery).toBe(semanticQuery);
    expect(widget.source_chart_id).toBe('chart_1');
    // Invariant §8: never trust client snapshots — emit empty, server re-freezes.
    expect(widget.measureSnapshots).toEqual([]);
    // Freshness defaults to live (absent).
    expect(widget.freshness).toBeUndefined();
    expect(widget.position).toEqual({ col: 0, row: 0, w: 6, h: 4 });
  });
});
