import {
  recommendChartKind,
  recommendedKindToWidgetKind,
  isTimeDimensionType,
  type ResolvedDefinitions,
} from '../chart-defaults';
import type { SemanticQuery } from '@/lib/semantic/types';

// ── Test helpers ────────────────────────────────────────────────────────────
function query(partial: Partial<SemanticQuery>): SemanticQuery {
  return {
    modelId: 'm1',
    entityId: 'e1',
    dimensions: [],
    measures: [],
    filters: [],
    sorts: [],
    ...partial,
  };
}

function defs(
  dims: Record<string, { type?: string; cardinality?: number | 'low' | 'high' }> = {},
  measures: string[] = [],
): ResolvedDefinitions {
  return {
    dimensions: Object.fromEntries(
      Object.entries(dims).map(([id, v]) => [id, { id, ...v }]),
    ),
    measures: Object.fromEntries(measures.map((id) => [id, { id }])),
  };
}

// ── isTimeDimensionType ─────────────────────────────────────────────────────
describe('isTimeDimensionType', () => {
  it('recognises the governed temporal type and common SQL date/time types', () => {
    for (const t of ['temporal', 'date', 'timestamp', 'datetime', 'time', 'TIMESTAMP', 'Timestamp_NTZ']) {
      expect(isTimeDimensionType(t)).toBe(true);
    }
  });

  it('treats categorical / numeric / missing types as non-time', () => {
    for (const t of ['categorical', 'string', 'numeric', 'int', undefined, '']) {
      expect(isTimeDimensionType(t as string | undefined)).toBe(false);
    }
  });
});

// ── recommendChartKind — one rule per describe ──────────────────────────────
describe('recommendChartKind', () => {
  it('1 measure + 0 dims → kpi', () => {
    const rec = recommendChartKind(
      query({ measures: [{ measureId: 'msr_rev' }] }),
      defs({}, ['msr_rev']),
    );
    expect(rec.chartKind).toBe('kpi');
    expect(rec.rationale).toMatch(/single value|KPI/i);
    expect(rec.alternatives).not.toContain('kpi');
  });

  it('2 measures + 0 dims → scatter (correlation)', () => {
    const rec = recommendChartKind(
      query({ measures: [{ measureId: 'a' }, { measureId: 'b' }] }),
      defs({}, ['a', 'b']),
    );
    expect(rec.chartKind).toBe('scatter');
    expect(rec.rationale).toMatch(/correlation/i);
  });

  it('1 time dimension + 1 measure → line (trend over time)', () => {
    const rec = recommendChartKind(
      query({
        dimensions: [{ dimensionId: 'dim_date' }],
        measures: [{ measureId: 'msr_rev' }],
      }),
      defs({ dim_date: { type: 'temporal' } }, ['msr_rev']),
    );
    expect(rec.chartKind).toBe('line');
    expect(rec.rationale).toMatch(/trend over time/i);
    expect(rec.alternatives).toContain('bar');
  });

  it('1 low-cardinality categorical + 1 measure → bar (comparison)', () => {
    const rec = recommendChartKind(
      query({
        dimensions: [{ dimensionId: 'dim_region' }],
        measures: [{ measureId: 'msr_rev' }],
      }),
      defs({ dim_region: { type: 'categorical' } }, ['msr_rev']),
    );
    expect(rec.chartKind).toBe('bar');
    expect(rec.rationale).toMatch(/comparison/i);
  });

  it('categorical with no cardinality hint defaults to bar (never pie)', () => {
    const rec = recommendChartKind(
      query({
        dimensions: [{ dimensionId: 'dim_region' }],
        measures: [{ measureId: 'msr_rev' }],
      }),
      defs({ dim_region: {} }, ['msr_rev']),
    );
    expect(rec.chartKind).toBe('bar');
  });

  it('1 high-cardinality categorical + 1 measure → sorted bar, NOT pie', () => {
    const rec = recommendChartKind(
      query({
        dimensions: [{ dimensionId: 'dim_customer' }],
        measures: [{ measureId: 'msr_rev' }],
      }),
      defs({ dim_customer: { type: 'categorical', cardinality: 500 } }, ['msr_rev']),
    );
    expect(rec.chartKind).toBe('bar');
    expect(rec.chartKind).not.toBe('pie');
    expect(rec.rationale).toMatch(/pie|slices/i);
  });

  it("treats an explicit 'high' cardinality bucket as high-cardinality", () => {
    const rec = recommendChartKind(
      query({
        dimensions: [{ dimensionId: 'dim_sku' }],
        measures: [{ measureId: 'msr_units' }],
      }),
      defs({ dim_sku: { type: 'categorical', cardinality: 'high' } }, ['msr_units']),
    );
    expect(rec.chartKind).toBe('bar');
    expect(rec.rationale).toMatch(/pie|slices/i);
  });

  it('2 dimensions + 1 measure → heatmap (matrix), grouped bar as alternative', () => {
    const rec = recommendChartKind(
      query({
        dimensions: [{ dimensionId: 'dim_region' }, { dimensionId: 'dim_month' }],
        measures: [{ measureId: 'msr_rev' }],
      }),
      defs({ dim_region: { type: 'categorical' }, dim_month: { type: 'categorical' } }, ['msr_rev']),
    );
    expect(rec.chartKind).toBe('heatmap');
    expect(rec.alternatives).toContain('bar');
  });

  it('falls back to table for 3+ dimensions', () => {
    const rec = recommendChartKind(
      query({
        dimensions: [
          { dimensionId: 'd1' },
          { dimensionId: 'd2' },
          { dimensionId: 'd3' },
        ],
        measures: [{ measureId: 'm1' }],
      }),
      defs({ d1: {}, d2: {}, d3: {} }, ['m1']),
    );
    expect(rec.chartKind).toBe('table');
  });

  it('falls back to table when dimensions exist but no measure', () => {
    const rec = recommendChartKind(
      query({ dimensions: [{ dimensionId: 'd1' }] }),
      defs({ d1: { type: 'categorical' } }, []),
    );
    expect(rec.chartKind).toBe('table');
    expect(rec.rationale).toMatch(/no measure/i);
  });

  it('falls back to table for empty query (no dims, no measures)', () => {
    const rec = recommendChartKind(query({}), defs({}, []));
    expect(rec.chartKind).toBe('table');
  });

  it('falls back to table for 3+ measures with no dimension', () => {
    const rec = recommendChartKind(
      query({ measures: [{ measureId: 'a' }, { measureId: 'b' }, { measureId: 'c' }] }),
      defs({}, ['a', 'b', 'c']),
    );
    expect(rec.chartKind).toBe('table');
  });

  it('multiple measures over one time dimension still recommends line', () => {
    const rec = recommendChartKind(
      query({
        dimensions: [{ dimensionId: 'dim_date' }],
        measures: [{ measureId: 'a' }, { measureId: 'b' }],
      }),
      defs({ dim_date: { type: 'timestamp' } }, ['a', 'b']),
    );
    expect(rec.chartKind).toBe('line');
  });

  it('never lists the chosen kind among its own alternatives', () => {
    const cases: Array<[SemanticQuery, ResolvedDefinitions]> = [
      [query({ measures: [{ measureId: 'a' }] }), defs({}, ['a'])],
      [
        query({ dimensions: [{ dimensionId: 'd' }], measures: [{ measureId: 'a' }] }),
        defs({ d: { type: 'temporal' } }, ['a']),
      ],
      [
        query({ dimensions: [{ dimensionId: 'd' }], measures: [{ measureId: 'a' }] }),
        defs({ d: { type: 'categorical' } }, ['a']),
      ],
    ];
    for (const [q, d] of cases) {
      const rec = recommendChartKind(q, d);
      expect(rec.alternatives).not.toContain(rec.chartKind);
    }
  });
});

// ── recommendedKindToWidgetKind ─────────────────────────────────────────────
describe('recommendedKindToWidgetKind', () => {
  it('maps pie → donut and table → bar, passes through the rest', () => {
    expect(recommendedKindToWidgetKind('pie')).toBe('donut');
    expect(recommendedKindToWidgetKind('table')).toBe('bar');
    expect(recommendedKindToWidgetKind('line')).toBe('line');
    expect(recommendedKindToWidgetKind('bar')).toBe('bar');
    expect(recommendedKindToWidgetKind('scatter')).toBe('scatter');
    expect(recommendedKindToWidgetKind('kpi')).toBe('kpi');
    expect(recommendedKindToWidgetKind('heatmap')).toBe('heatmap');
  });
});
