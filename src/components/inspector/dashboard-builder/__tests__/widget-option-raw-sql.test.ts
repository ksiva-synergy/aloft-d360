import { describe, it, expect } from 'vitest';
import { rawSqlWidgetToChartSpec } from '../widget-option';
import { buildRawSqlWidgetSpec } from '@/lib/dashboards/raw-sql-chart';

/**
 * The inverted §4.5 gotcha: raw-SQL widgets bind chartConfig.x/.y DIRECTLY to
 * the SQL result column names. These tests lock in that a chart built from real
 * column names produces filled series — the exact failure mode (silently empty
 * series) that aliasing would reintroduce.
 */
describe('rawSqlWidgetToChartSpec', () => {
  const rows = [
    { VesselType: 'Bulk', vessel_count: 12 },
    { VesselType: 'Tanker', vessel_count: 7 },
  ];

  const widget = buildRawSqlWidgetSpec({
    widgetId: 'w1',
    title: 'Vessels by type',
    rawSql: 'SELECT VesselType, count(*) AS vessel_count FROM v GROUP BY 1',
    resultSchema: [
      { name: 'VesselType', type: 'string' },
      { name: 'vessel_count', type: 'bigint' },
    ],
    connectionId: 'c1',
    dsl: { source: 'raw_sql', kind: 'bar', x: 'VesselType', y: ['vessel_count'] },
    position: { col: 0, row: 0, w: 6, h: 4 },
  });

  it('binds series data to the actual column name (not an alias)', () => {
    const spec = rawSqlWidgetToChartSpec(widget, rows);
    expect(spec).not.toBeNull();
    const option = spec!.echartsOption as {
      xAxis: { data: unknown[] };
      series: { name: string; data: unknown[] }[];
    };
    // X categories come straight from row['VesselType'].
    expect(option.xAxis.data).toEqual(['Bulk', 'Tanker']);
    // Series values come straight from row['vessel_count'] — NOT toAlias(...).
    expect(option.series).toHaveLength(1);
    expect(option.series[0].name).toBe('vessel_count');
    expect(option.series[0].data).toEqual([12, 7]);
  });

  it('renders the NO DATA placeholder when rows are absent', () => {
    const spec = rawSqlWidgetToChartSpec(widget, undefined);
    const option = spec!.echartsOption as { graphic?: unknown; series: { data: unknown[] }[] };
    expect(option.graphic).toBeDefined();
    expect(option.series[0].data).toEqual([]);
  });

  it('returns null when axis config is incomplete', () => {
    const noX = buildRawSqlWidgetSpec({
      widgetId: 'w2',
      title: 't',
      rawSql: 'SELECT 1',
      resultSchema: [],
      connectionId: 'c1',
      dsl: { source: 'raw_sql', kind: 'bar', x: '', y: [] },
      position: { col: 0, row: 0, w: 6, h: 4 },
    });
    expect(rawSqlWidgetToChartSpec(noX, rows)).toBeNull();
  });

  it('reads the KPI value from the first row by column name', () => {
    const kpi = { ...widget, chartKind: 'kpi' as const };
    const spec = rawSqlWidgetToChartSpec(kpi, rows);
    expect(spec!.kind).toBe('kpi');
    // buildKpiOption renders the value text; just assert it did not blank out.
    const option = spec!.echartsOption as { graphic: { elements: { style: { text: string } }[] } };
    expect(option.graphic.elements[0].style.text).toBe('12');
  });
});
