import {
  computeWidgetDiff,
  widgetDiffIsEmpty,
  summarizeWidgetDiff,
  type WidgetDiffLabelResolver,
} from '../widget-diff';
import type { WidgetSpec } from '../types';
import type { SemanticQuery, SemanticFilter } from '@/lib/semantic/types';

// ── Test helpers ──────────────────────────────────────────────────────────
function sq(partial: Partial<SemanticQuery> = {}): SemanticQuery {
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

function widget(partial: Partial<WidgetSpec> = {}): WidgetSpec {
  return {
    widgetId: 'w1',
    title: 'Widget',
    chartKind: 'bar',
    semanticQuery: sq(partial.semanticQuery),
    measureSnapshots: [],
    chartConfig: {},
    position: { col: 0, row: 0, w: 6, h: 4 },
    ...partial,
    // ensure semanticQuery is the fully-defaulted one when caller passed a partial
    ...(partial.semanticQuery ? { semanticQuery: sq(partial.semanticQuery) } : {}),
  };
}

// A resolver that maps IDs to friendly labels for the label-surfacing tests.
const labels: Record<string, string> = {
  dim_region: 'Region',
  dim_date: 'Order Date',
  msr_rev: 'Total Revenue',
  msr_count: 'Order Count',
};
const resolve: WidgetDiffLabelResolver = (id) => labels[id] ?? id;

// ── No change ───────────────────────────────────────────────────────────────
describe('computeWidgetDiff — no change', () => {
  it('returns an empty diff for identical widgets', () => {
    const w = widget({
      semanticQuery: sq({ dimensions: [{ dimensionId: 'dim_region' }], measures: [{ measureId: 'msr_rev' }] }),
    });
    const diff = computeWidgetDiff(w, structuredClone(w), resolve);
    expect(widgetDiffIsEmpty(diff)).toBe(true);
    expect(diff).toEqual({});
    expect(summarizeWidgetDiff(diff)).toEqual([]);
  });
});

// ── Chart kind change only ────────────────────────────────────────────────
describe('computeWidgetDiff — chart kind', () => {
  it('detects a kind change and nothing else', () => {
    const before = widget({ chartKind: 'bar' });
    const after = widget({ chartKind: 'line' });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.chartKindChanged).toEqual({ from: 'bar', to: 'line' });
    expect(diff.dimensionsAdded).toBeUndefined();
    expect(diff.measuresAdded).toBeUndefined();
    expect(widgetDiffIsEmpty(diff)).toBe(false);
    expect(summarizeWidgetDiff(diff)).toEqual(['Changed chart kind: bar → line']);
  });
});

// ── Added dimension ───────────────────────────────────────────────────────
describe('computeWidgetDiff — added dimension', () => {
  it('surfaces the added dimension label', () => {
    const before = widget({ semanticQuery: sq({ measures: [{ measureId: 'msr_rev' }] }) });
    const after = widget({
      semanticQuery: sq({ dimensions: [{ dimensionId: 'dim_region' }], measures: [{ measureId: 'msr_rev' }] }),
    });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.dimensionsAdded).toEqual(['Region']);
    expect(diff.dimensionsRemoved).toBeUndefined();
    expect(summarizeWidgetDiff(diff)).toContain('Added dimension: Region');
  });

  it('falls back to the raw ID when no resolver is supplied', () => {
    const before = widget();
    const after = widget({ semanticQuery: sq({ dimensions: [{ dimensionId: 'dim_region' }] }) });
    const diff = computeWidgetDiff(before, after);
    expect(diff.dimensionsAdded).toEqual(['dim_region']);
  });
});

// ── Removed measure ───────────────────────────────────────────────────────
describe('computeWidgetDiff — removed measure', () => {
  it('surfaces the removed measure label', () => {
    const before = widget({
      semanticQuery: sq({ measures: [{ measureId: 'msr_rev' }, { measureId: 'msr_count' }] }),
    });
    const after = widget({ semanticQuery: sq({ measures: [{ measureId: 'msr_rev' }] }) });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.measuresRemoved).toEqual(['Order Count']);
    expect(diff.measuresAdded).toBeUndefined();
    expect(summarizeWidgetDiff(diff)).toContain('Removed measure: Order Count');
  });
});

// ── Added measure ─────────────────────────────────────────────────────────
describe('computeWidgetDiff — added measure', () => {
  it('surfaces the added measure label', () => {
    const before = widget({ semanticQuery: sq({ measures: [{ measureId: 'msr_rev' }] }) });
    const after = widget({
      semanticQuery: sq({ measures: [{ measureId: 'msr_rev' }, { measureId: 'msr_count' }] }),
    });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.measuresAdded).toEqual(['Order Count']);
  });
});

// ── Filter change ─────────────────────────────────────────────────────────
describe('computeWidgetDiff — filters', () => {
  it('detects an added filter', () => {
    const filter: SemanticFilter = { fieldId: 'dim_date', fieldKind: 'dimension', op: 'gte', value: '2025-01-01' };
    const before = widget();
    const after = widget({ semanticQuery: sq({ filters: [filter] }) });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.filtersChanged).toBe(true);
  });

  it('detects an edited filter value', () => {
    const before = widget({ semanticQuery: sq({ filters: [{ fieldId: 'dim_date', fieldKind: 'dimension', op: 'gte', value: '2024-01-01' }] }) });
    const after = widget({ semanticQuery: sq({ filters: [{ fieldId: 'dim_date', fieldKind: 'dimension', op: 'gte', value: '2025-01-01' }] }) });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.filtersChanged).toBe(true);
  });

  it('does not flag identical filters', () => {
    const filter: SemanticFilter = { fieldId: 'dim_date', fieldKind: 'dimension', op: 'gte', value: '2025-01-01' };
    const before = widget({ semanticQuery: sq({ filters: [filter] }) });
    const after = widget({ semanticQuery: sq({ filters: [{ ...filter }] }) });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.filtersChanged).toBeUndefined();
  });
});

// ── Config change ─────────────────────────────────────────────────────────
describe('computeWidgetDiff — chart config', () => {
  it('detects an axis-mapping change', () => {
    const before = widget({ chartConfig: { x: 'a', y: ['b'] } });
    const after = widget({ chartConfig: { x: 'a', y: ['b', 'c'] } });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.configChanged).toBe(true);
  });
});

// ── Multiple changes simultaneously ─────────────────────────────────────────
describe('computeWidgetDiff — multiple changes', () => {
  it('reports every changed facet at once', () => {
    const before = widget({
      chartKind: 'bar',
      semanticQuery: sq({ measures: [{ measureId: 'msr_rev' }] }),
      chartConfig: { x: 'a' },
    });
    const after = widget({
      chartKind: 'line',
      semanticQuery: sq({
        dimensions: [{ dimensionId: 'dim_region' }],
        measures: [{ measureId: 'msr_rev' }, { measureId: 'msr_count' }],
        filters: [{ fieldId: 'dim_date', fieldKind: 'dimension', op: 'gte', value: '2025-01-01' }],
      }),
      chartConfig: { x: 'b' },
    });
    const diff = computeWidgetDiff(before, after, resolve);
    expect(diff.chartKindChanged).toEqual({ from: 'bar', to: 'line' });
    expect(diff.dimensionsAdded).toEqual(['Region']);
    expect(diff.measuresAdded).toEqual(['Order Count']);
    expect(diff.filtersChanged).toBe(true);
    expect(diff.configChanged).toBe(true);
    expect(widgetDiffIsEmpty(diff)).toBe(false);
    expect(summarizeWidgetDiff(diff).length).toBe(5);
  });
});
