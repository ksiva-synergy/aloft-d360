import { describe, it, expect } from 'vitest';
import { blueprintToWidgetSpec } from '../blueprint-widget';
import { isSemanticWidget } from '../types';
import type { ChartBlueprint } from '../guided-types';

const governed: ChartBlueprint = {
  id: 'bp_0',
  title: 'Accidents by root cause',
  measureIds: ['meas_accidents'],
  dimensionIds: ['dim_root_cause'],
  measureLabels: ['Accident count'],
  dimensionLabels: ['Root cause category'],
  filters: [{ fieldId: 'dim_vessel', fieldKind: 'dimension', op: 'eq', value: 'MV Aloft' }],
  chartKindGuess: 'bar',
  rationale: 'Compares accident volume across causes.',
  grounding: 'governed',
};

const undefinedItem: ChartBlueprint = {
  id: 'bp_1',
  title: 'Near-miss rate',
  measureIds: [], dimensionIds: [], measureLabels: [], dimensionLabels: [],
  filters: [], chartKindGuess: 'table', rationale: '', grounding: 'undefined',
  undefinedTerm: 'near-miss rate',
};

describe('blueprintToWidgetSpec — Appendix C contract', () => {
  it('maps a governed item to a semantic widget preserving IDs as live references', () => {
    const spec = blueprintToWidgetSpec(governed, { modelId: 'model_dash', entityId: 'ent_1', widgetId: 'w1' });
    expect(spec).not.toBeNull();
    expect(isSemanticWidget(spec!)).toBe(true);
    expect(spec!.semanticQuery.measures).toEqual([{ measureId: 'meas_accidents' }]);
    expect(spec!.semanticQuery.dimensions).toEqual([{ dimensionId: 'dim_root_cause' }]);
    // Filters carried as governed filters (not row hacks).
    expect(spec!.semanticQuery.filters).toEqual(governed.filters);
    expect(spec!.chartKind).toBe('bar');
    expect(spec!.title).toBe('Accidents by root cause');
  });

  it('DEFENSIVE PIN: semanticQuery.modelId comes from the binding, not any stored value', () => {
    const spec = blueprintToWidgetSpec(governed, { modelId: 'DASHBOARD_MODEL', entityId: 'ent_1', widgetId: 'w1' });
    expect(spec!.semanticQuery.modelId).toBe('DASHBOARD_MODEL');
  });

  it('leaves measureSnapshots EMPTY — they are re-frozen server-side at pin', () => {
    const spec = blueprintToWidgetSpec(governed, { modelId: 'm', entityId: 'e', widgetId: 'w1' });
    expect(spec!.measureSnapshots).toEqual([]);
  });

  it('carries an optional chat-chart back-ref only when supplied', () => {
    const withRef = blueprintToWidgetSpec(governed, { modelId: 'm', entityId: 'e', widgetId: 'w1', sourceChartId: 'chart_9' });
    expect(withRef!.source_chart_id).toBe('chart_9');
    const without = blueprintToWidgetSpec(governed, { modelId: 'm', entityId: 'e', widgetId: 'w1' });
    expect(without!.source_chart_id).toBeUndefined();
  });

  it('refuses to map an undefined item (no governed measure → no fabricated widget)', () => {
    const spec = blueprintToWidgetSpec(undefinedItem, { modelId: 'm', entityId: 'e', widgetId: 'w1' });
    expect(spec).toBeNull();
  });
});
