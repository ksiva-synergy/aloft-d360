/**
 * THE toAlias GUARD (guided-viz redesign, step 5 hold point).
 *
 * The redesign's honesty rests on this: a live preview must bind real numbers
 * only when the result rows are keyed by the compiler's alias, toAlias(label) —
 * and must visibly FAIL to bind (all-null series) when they are not. Both halves
 * are asserted so a green run proves the test would actually catch the §4.5
 * regression, not pass incidentally.
 *
 * Path under test (the real-data path SamplePreviewChart uses):
 *   rows  →  renderStateFromResult(result, shape)  →  rowsToOption (toAlias)
 *         →  RowsToOptionResult  →  buildPreviewOption  →  option.series[].data
 *
 * Pure: no React, no ECharts, no I/O.
 */
import { describe, it, expect } from 'vitest';
import { toAlias } from '@/lib/semantic/compiler';
import { renderStateFromResult, type WidgetChartShape } from '@/lib/dashboards/widget-render-state';
import { buildPreviewOption } from '@/lib/dashboards/preview-option';
import { colorForMeasure } from '@/lib/dashboards/inspector-viz-tokens';
import type { WidgetDataResult } from '@/lib/dashboards/types';

const MEASURE_LABEL = 'Total Revenue';
const DIM_LABEL = 'Month';

const shape: WidgetChartShape = {
  chartKind: 'bar',
  dimensions: [{ dimensionId: 'd_month', label: DIM_LABEL }],
  measures: [{ measureId: 'm_rev', label: MEASURE_LABEL }],
};

/** A well-formed 'ok' WidgetDataResult carrying the given rows. */
function okResult(rows: Record<string, unknown>[]): WidgetDataResult {
  return {
    status: 'ok',
    rows,
    sql: 'SELECT ...',
    definitionsUsed: { dimensions: ['d_month'], measures: ['m_rev'] },
    executedAt: '2026-07-27T00:00:00.000Z',
  };
}

function seriesData(rows: Record<string, unknown>[]): unknown[] {
  const state = renderStateFromResult(okResult(rows), shape);
  // Rows are present in both halves, so this is 'ok' either way — the empty
  // guard (isEmpty) does NOT catch a wrong-key bind; only the values differ.
  expect(state.kind).toBe('ok');
  const chart = state.kind === 'ok' ? state.chart : { series: [], categories: [], dimAliases: [], isEmpty: true };
  const option = buildPreviewOption('bar', chart, { inkColor: '#e6edf3', seriesIdentities: ['m_rev'] });
  return (option.series as Array<{ data: unknown[] }>)[0].data;
}

describe('toAlias binding guard (preview option)', () => {
  it('sanity: toAlias(label) is the snake_case key, distinct from the raw label', () => {
    expect(toAlias(MEASURE_LABEL)).toBe('total_revenue');
    expect(toAlias(MEASURE_LABEL)).not.toBe(MEASURE_LABEL);
  });

  it('POSITIVE half — rows keyed by toAlias(label) bind real numbers', () => {
    const rows = [
      { [toAlias(DIM_LABEL)]: 'Jan', [toAlias(MEASURE_LABEL)]: 100 },
      { [toAlias(DIM_LABEL)]: 'Feb', [toAlias(MEASURE_LABEL)]: 140 },
    ];
    const data = seriesData(rows);
    expect(data).toEqual([100, 140]);
    expect(data.filter((v) => typeof v === 'number' && Number.isFinite(v)).length).toBe(2);
  });

  it('NEGATIVE half — rows keyed by the RAW label bind nothing (all-null series)', () => {
    // The §4.5 false-green: rows present (so not "empty"), but keyed by the human
    // label instead of toAlias → every lookup misses → a silently empty series.
    const rows = [
      { [DIM_LABEL]: 'Jan', [MEASURE_LABEL]: 100 },
      { [DIM_LABEL]: 'Feb', [MEASURE_LABEL]: 140 },
    ];
    const data = seriesData(rows);
    expect(data).toEqual([null, null]);
    expect(data.filter((v) => typeof v === 'number' && Number.isFinite(v)).length).toBe(0);
  });

  it('same metric identity → same colour regardless of series order', () => {
    // The colour half of "same metric = same colour everywhere": colorForMeasure
    // is keyed on identity, so option.color encodes the metric, not its position.
    const first = colorForMeasure('m_rev');
    const asFirst = buildPreviewOption(
      'bar',
      { isEmpty: false, categories: ['a'], dimAliases: ['d'], series: [
        { measureId: 'm_rev', name: 'Rev', alias: 'rev', data: [1], unit: null, format: null },
        { measureId: 'm_cost', name: 'Cost', alias: 'cost', data: [2], unit: null, format: null },
      ] },
      { inkColor: '#fff', seriesIdentities: ['m_rev', 'm_cost'] },
    );
    const asSecond = buildPreviewOption(
      'bar',
      { isEmpty: false, categories: ['a'], dimAliases: ['d'], series: [
        { measureId: 'm_cost', name: 'Cost', alias: 'cost', data: [2], unit: null, format: null },
        { measureId: 'm_rev', name: 'Rev', alias: 'rev', data: [1], unit: null, format: null },
      ] },
      { inkColor: '#fff', seriesIdentities: ['m_cost', 'm_rev'] },
    );
    expect((asFirst.color as string[])[0]).toBe(first);
    expect((asSecond.color as string[])[1]).toBe(first);
  });
});
