import { useBuilderStore } from '../builder-store';

describe('builder-store — mode toggle is lossless (Phase 1 round-trip)', () => {
  beforeEach(() => {
    useBuilderStore.getState().loadWidgets([]);
    useBuilderStore.getState().setMode('manual');
  });

  it('defaults to manual', () => {
    expect(useBuilderStore.getState().mode).toBe('manual');
  });

  it('setMode switches between the three modes', () => {
    useBuilderStore.getState().setMode('guided');
    expect(useBuilderStore.getState().mode).toBe('guided');
    useBuilderStore.getState().setMode('view');
    expect(useBuilderStore.getState().mode).toBe('view');
  });

  it('guided → manual → guided preserves the widgets (two views over one WidgetSpec[])', () => {
    useBuilderStore.getState().setMode('guided');
    useBuilderStore.getState().setDashboard('d1', 'model_abc', 'Dash', null);
    const wid = useBuilderStore.getState().addWidget('bar', 'Widget 1');
    const widgetsBefore = useBuilderStore.getState().widgets;

    useBuilderStore.getState().setMode('manual');
    expect(useBuilderStore.getState().widgets).toEqual(widgetsBefore);

    useBuilderStore.getState().setMode('guided');
    const s = useBuilderStore.getState();
    expect(s.mode).toBe('guided');
    expect(s.widgets).toEqual(widgetsBefore);
    expect(s.widgets.find((w) => w.widgetId === wid)).toBeTruthy();
  });

  it('setMode never mutates the widget list', () => {
    useBuilderStore.getState().setDashboard('d1', 'model_abc', 'Dash', null);
    useBuilderStore.getState().addWidget('kpi', 'K');
    const before = useBuilderStore.getState().widgets;
    useBuilderStore.getState().setMode('view');
    expect(useBuilderStore.getState().widgets).toBe(before); // same reference — untouched
  });
});
