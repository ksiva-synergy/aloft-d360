import { useBuilderStore } from '../builder-store';
import type { ResolvedIntent } from '@/lib/dashboards/guided-types';

const sample: ResolvedIntent = {
  modelId: 'model_abc',
  topic: 'Which vessels and root causes drive most accidents this year?',
  relevantMeasureIds: ['meas_accidents'],
  relevantDimensionIds: ['dim_vessel', 'dim_root_cause'],
  disambiguations: [
    { term: 'accidents', resolution: 'matched', candidates: [{ id: 'meas_accidents', label: 'Accident count' }], chosenId: 'meas_accidents' },
    { term: 'root causes', resolution: 'ambiguous', candidates: [
      { id: 'dim_root_cause', label: 'Root cause category', description: 'Primary categorised cause' },
      { id: 'dim_root_cause_2', label: 'Root cause (free text)' },
    ], chosenId: 'dim_root_cause' },
    { term: 'near miss', resolution: 'not_governed', candidates: [{ id: 'dim_near_miss', label: 'Near miss type' }] },
    { term: 'sasquatch', resolution: 'unrecognized', candidates: [], cappedByTopK: true },
  ],
};

describe('builder-store — guidedSession slice', () => {
  beforeEach(() => {
    useBuilderStore.getState().clearGuidedSession();
  });

  it('starts with a null intent', () => {
    expect(useBuilderStore.getState().guidedSession.intent).toBeNull();
  });

  it('emits ResolvedIntent losslessly into guidedSession.intent (round-trip)', () => {
    useBuilderStore.getState().setIntent(sample);
    const readBack = useBuilderStore.getState().guidedSession.intent;
    // Deep round-trip: nothing lost, including the four-state resolutions and
    // the {id,label,description} candidates.
    expect(readBack).toEqual(sample);
  });

  it('setIntent(null) clears it', () => {
    useBuilderStore.getState().setIntent(sample);
    useBuilderStore.getState().setIntent(null);
    expect(useBuilderStore.getState().guidedSession.intent).toBeNull();
  });

  it('clearGuidedSession resets the slice', () => {
    useBuilderStore.getState().setIntent(sample);
    useBuilderStore.getState().clearGuidedSession();
    expect(useBuilderStore.getState().guidedSession.intent).toBeNull();
  });

  it('does not disturb the widget/dashboard slices', () => {
    useBuilderStore.getState().setDashboard('dash1', 'model_abc', 'My Dashboard', null);
    useBuilderStore.getState().setIntent(sample);
    const s = useBuilderStore.getState();
    expect(s.dashboardId).toBe('dash1');
    expect(s.modelId).toBe('model_abc');
    expect(s.widgets).toEqual([]);
  });
});

// The mode-slice round-trip (widgets only) is Phase 1's test
// (builder-store-mode.test.ts). This asserts the Phase-2 addition: the resolved
// INTENT also survives the same toggle, since guidedSession rides the one store.
describe('builder-store — intent survives the mode toggle (guidedSession losslessness)', () => {
  beforeEach(() => {
    useBuilderStore.getState().clearGuidedSession();
    useBuilderStore.getState().loadWidgets([]);
    useBuilderStore.getState().setMode('manual');
  });

  it('guided → manual → guided preserves widgets AND the resolved intent', () => {
    // Build some state under guided.
    useBuilderStore.getState().setMode('guided');
    useBuilderStore.getState().setDashboard('d1', 'model_abc', 'Dash', null);
    useBuilderStore.getState().setIntent(sample);
    const wid = useBuilderStore.getState().addWidget('bar', 'Widget 1');

    const widgetsBefore = useBuilderStore.getState().widgets;

    // Toggle to manual and back — two views over one WidgetSpec[].
    useBuilderStore.getState().setMode('manual');
    expect(useBuilderStore.getState().widgets).toEqual(widgetsBefore);
    expect(useBuilderStore.getState().guidedSession.intent).toEqual(sample);

    useBuilderStore.getState().setMode('guided');
    const s = useBuilderStore.getState();
    expect(s.mode).toBe('guided');
    expect(s.widgets).toEqual(widgetsBefore);
    expect(s.widgets.find((w) => w.widgetId === wid)).toBeTruthy();
    expect(s.guidedSession.intent).toEqual(sample);
  });
});
