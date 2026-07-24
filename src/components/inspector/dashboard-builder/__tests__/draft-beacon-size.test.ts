import { describe, it, expect } from 'vitest';

/**
 * Track B / Pre-flight P1 quantification (NOT a browser test).
 *
 * `use-draft-autosave.ts#buildBody` serializes FULL store state (widgets + layouts
 * + guidedSession) for BOTH the debounced write and the on-hide beacon — there is
 * no trailing-delta path. `navigator.sendBeacon` enforces a ~64 KiB per-origin
 * in-flight budget that the keepalive-fetch fallback shares, so an over-budget
 * on-hide flush can be silently dropped and NOT rescued by the fallback.
 *
 * This test measures the serialized body (Buffer byte length == Blob size for
 * UTF-8) at realistic widget counts to answer: at what dashboard size does the
 * on-hide beacon cross the cap? It quantifies the risk that Test 1 must exercise
 * in a real browser; it does not itself prove delivery.
 */

const BEACON_CAP = 64 * 1024;

// A representative semantic widget, shaped like the ones the builder actually
// stores (semanticQuery with a couple of dims/measures, a frozen snapshot, a
// non-trivial chartConfig, a grid position).
function makeWidget(i: number) {
  return {
    widgetId: `wgt_${i}_${'c'.repeat(8)}`,
    title: `Revenue by region — panel ${i}`,
    chartKind: 'bar',
    chartSource: 'semantic',
    source_chart_id: `chart_${i}_${'d'.repeat(8)}`,
    semanticQuery: {
      modelId: `mdl_${'a'.repeat(16)}`,
      entityId: `ent_${'b'.repeat(16)}`,
      dimensions: [{ dimensionId: `dim_${'e'.repeat(16)}` }, { dimensionId: `dim_${'f'.repeat(16)}` }],
      measures: [{ measureId: `mea_${'g'.repeat(16)}` }, { measureId: `mea_${'h'.repeat(16)}` }],
      filters: [{ dimensionId: `dim_${'e'.repeat(16)}`, op: 'in', values: ['north', 'south', 'east'] }],
      sorts: [{ measureId: `mea_${'g'.repeat(16)}`, dir: 'desc' }],
    },
    measureSnapshots: [
      { measureId: `mea_${'g'.repeat(16)}`, aggregate: 'sum', expression: null, metric_type: 'additive' },
      { measureId: `mea_${'h'.repeat(16)}`, aggregate: 'avg', expression: 'x/y', metric_type: 'ratio' },
    ],
    chartConfig: { xEncoding: 'dimension', yEncoding: 'measure', stack: true, legend: 'right', palette: 'category-10' },
    position: { col: (i % 2) * 6, row: Math.floor(i / 2) * 4, w: 6, h: 4 },
  };
}

function buildBody(widgetCount: number, withGuided: boolean) {
  const widgets = Array.from({ length: widgetCount }, (_, i) => makeWidget(i));
  const guidedSession = withGuided
    ? {
        intent: { question: 'How does revenue trend by region and product line over the last year?', modelId: 'mdl', fields: Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, label: `field ${i}`, kind: 'measure' })) },
        blueprint: { items: Array.from({ length: widgetCount }, (_, i) => ({ id: `bp_${i}`, title: `Chart ${i}`, chartKind: 'bar', dimensionIds: [`dim_${i}`], measureIds: [`mea_${i}`], rationale: 'grounded server-side' })) },
        drillIn: { cursor: 0, widgetIdByItemId: {} },
      }
    : { intent: null, blueprint: null, drillIn: { cursor: 0, widgetIdByItemId: {} } };
  return JSON.stringify({
    widgets,
    layouts: { columns: 12, rows: widgets.map((w) => ({ widgetId: w.widgetId, ...w.position })) },
    guidedSession,
    baseVersionId: 'ver_current',
  });
}

const size = (n: number, guided: boolean) => Buffer.byteLength(buildBody(n, guided), 'utf8');

describe('draft on-hide beacon payload size (P1 quantification)', () => {
  it('reports serialized body size across realistic dashboard sizes', () => {
    const rows = [10, 25, 50, 100, 150].map((n) => ({
      widgets: n,
      bytesNoGuided: size(n, false),
      bytesWithGuided: size(n, true),
    }));
    // Surfaced in test output — this is the data the fix/defer decision needs.
    // eslint-disable-next-line no-console
    console.table(rows.map((r) => ({
      widgets: r.widgets,
      'KiB (no guided)': (r.bytesNoGuided / 1024).toFixed(1),
      'KiB (+guided)': (r.bytesWithGuided / 1024).toFixed(1),
      'over 64KiB?': r.bytesWithGuided > BEACON_CAP ? 'YES' : r.bytesNoGuided > BEACON_CAP ? 'no-guided-only' : 'no',
    })));
    expect(rows.length).toBe(5);
  });

  it('confirms the 64 KiB cap is REACHABLE (the risk is real, not structural-impossible)', () => {
    // A heavy-but-not-absurd dashboard must be able to cross the cap; otherwise
    // Test 1 would be un-triggerable and the risk moot.
    const crossings = [50, 100, 150, 200].filter((n) => size(n, true) > BEACON_CAP);
    expect(crossings.length).toBeGreaterThan(0);
  });

  it('confirms a typical small dashboard stays well under the cap (no false alarm)', () => {
    expect(size(10, false)).toBeLessThan(BEACON_CAP);
  });
});
