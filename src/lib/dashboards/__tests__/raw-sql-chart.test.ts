import { describe, it, expect } from 'vitest';
import {
  isRawSqlChartDsl,
  rawKindToWidgetKind,
  rawDslToChartConfig,
  buildRawSqlWidgetSpec,
  type RawSqlChartDsl,
} from '../raw-sql-chart';

describe('raw-sql-chart', () => {
  describe('isRawSqlChartDsl', () => {
    it('accepts a raw-SQL dsl', () => {
      expect(isRawSqlChartDsl({ source: 'raw_sql', kind: 'bar', x: 'a', y: ['b'] })).toBe(true);
    });
    it('rejects a semantic ChartDSLSpec (no source marker)', () => {
      expect(isRawSqlChartDsl({ kind: 'bar', encodings: [] })).toBe(false);
    });
    it('rejects non-objects', () => {
      expect(isRawSqlChartDsl(null)).toBe(false);
      expect(isRawSqlChartDsl('raw_sql')).toBe(false);
    });
  });

  describe('rawKindToWidgetKind', () => {
    it('maps 1:1 for bar/line/scatter', () => {
      expect(rawKindToWidgetKind('bar')).toBe('bar');
      expect(rawKindToWidgetKind('line')).toBe('line');
      expect(rawKindToWidgetKind('scatter')).toBe('scatter');
    });
    it('downgrades area to line and pie to donut', () => {
      expect(rawKindToWidgetKind('area')).toBe('line');
      expect(rawKindToWidgetKind('pie')).toBe('donut');
    });
  });

  describe('rawDslToChartConfig', () => {
    it('passes axis columns through verbatim (no aliasing)', () => {
      const dsl: RawSqlChartDsl = { source: 'raw_sql', kind: 'bar', x: 'VesselType', y: ['vessel_count'] };
      const config = rawDslToChartConfig(dsl);
      expect(config.x).toBe('VesselType');
      expect(config.y).toEqual(['vessel_count']);
      expect(config.echartsOption).toBeUndefined();
    });
    it('adds an area fill override for area kind', () => {
      const config = rawDslToChartConfig({ source: 'raw_sql', kind: 'area', x: 'd', y: ['v'] });
      expect(config.echartsOption).toEqual({ series: [{ areaStyle: {} }] });
    });
    it('omits empty axis fields', () => {
      const config = rawDslToChartConfig({ source: 'raw_sql', kind: 'bar', x: '', y: [] });
      expect(config.x).toBeUndefined();
      expect(config.y).toBeUndefined();
    });
  });

  describe('buildRawSqlWidgetSpec', () => {
    const dsl: RawSqlChartDsl = { source: 'raw_sql', kind: 'bar', x: 'VesselType', y: ['vessel_count'] };
    const base = {
      widgetId: 'w1',
      title: 'Vessels by type',
      rawSql: 'SELECT VesselType, count(*) AS vessel_count FROM v GROUP BY 1',
      resultSchema: [
        { name: 'VesselType', type: 'string' },
        { name: 'vessel_count', type: 'bigint' },
      ],
      connectionId: 'conn-123',
      dsl,
      position: { col: 0, row: 0, w: 6, h: 4 },
    };

    it('produces a raw_sql-discriminated widget with no semantic fields', () => {
      const spec = buildRawSqlWidgetSpec(base);
      expect(spec.chartSource).toBe('raw_sql');
      expect(spec.rawSql).toBe(base.rawSql);
      expect(spec.connectionId).toBe('conn-123');
      expect(spec.resultSchema).toHaveLength(2);
      expect(spec.chartKind).toBe('bar');
      expect(spec.chartConfig.x).toBe('VesselType');
      expect(spec.chartConfig.y).toEqual(['vessel_count']);
      // No semanticQuery / measureSnapshots present.
      expect('semanticQuery' in spec).toBe(false);
      expect('measureSnapshots' in spec).toBe(false);
    });

    it('records source_chart_id only when provided', () => {
      expect(buildRawSqlWidgetSpec(base).source_chart_id).toBeUndefined();
      expect(buildRawSqlWidgetSpec({ ...base, sourceChartId: 'c9' }).source_chart_id).toBe('c9');
    });
  });
});
