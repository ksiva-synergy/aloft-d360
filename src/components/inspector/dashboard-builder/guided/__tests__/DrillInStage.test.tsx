// @vitest-environment jsdom
/**
 * Phase-4 drill-in shell — render-level coverage.
 *
 * Covers the invariants that only exist in the render layer:
 *   - the chart area renders the TYPED "awaiting data / not wired" state, never a
 *     live-looking chart (anti-false-green, Task 4);
 *   - Confirm builds a WidgetSpec via the Phase-3 mapping and appends it to the
 *     shared store — spec mutation only, no execution/no snapshot compute (Task 5);
 *   - an 'undefined' item is not confirmable (never fabricate a chart with no data);
 *   - guided↔manual↔guided under a REAL render preserves populated widgets and
 *     confirmed-state across re-mount (Task 6 — the round-trip Phase 1 couldn't
 *     prove at the render level).
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrillInStage } from '../DrillInStage';
import { useBuilderStore } from '../../builder-store';
import { isSemanticWidget } from '@/lib/dashboards/types';
import type { ChartBlueprint, GuidedBlueprint } from '@/lib/dashboards/guided-types';
import type { ResolvedDefinitions } from '@/lib/dashboards/chart-defaults';
import type { WidgetDataResult } from '@/lib/dashboards/types';

/** A benign per-widget result so a confirmed item's live-preview fetch resolves. */
const OK_RESULT: WidgetDataResult = {
  status: 'ok',
  rows: [{ month: 'Jan', accident_count: 3 }],
  sql: 'SELECT month, accident_count FROM ...',
  definitionsUsed: { dimensions: ['dim_month'], measures: ['meas_accidents'] },
  executedAt: '2026-07-20T00:00:00.000Z',
};

const RESOLVED_DEFS: ResolvedDefinitions = {
  dimensions: { dim_month: { id: 'dim_month', type: 'temporal' } },
  measures: { meas_accidents: { id: 'meas_accidents' } },
};

const GOVERNED: ChartBlueprint = {
  id: 'bp_governed',
  title: 'Accidents over time',
  measureIds: ['meas_accidents'],
  dimensionIds: ['dim_month'],
  measureLabels: ['Accident count'],
  dimensionLabels: ['Month'],
  filters: [],
  chartKindGuess: 'line',
  rationale: '1 time dimension + measure = trend over time.',
  grounding: 'governed',
};

const UNDEFINED_ITEM: ChartBlueprint = {
  id: 'bp_undef',
  title: 'Near-miss rate',
  measureIds: [], dimensionIds: [], measureLabels: [], dimensionLabels: [],
  filters: [], chartKindGuess: 'table', rationale: '', grounding: 'undefined', undefinedTerm: 'near-miss rate',
};

function seedBlueprint(items: ChartBlueprint[]) {
  const bp: GuidedBlueprint = { modelId: 'model_1', modelStatus: 'governed', items };
  useBuilderStore.getState().setDashboard('dash_1', 'model_1', 'Safety', null);
  useBuilderStore.getState().setBlueprint(bp);
}

describe('DrillInStage — Phase 4 shell', () => {
  beforeEach(() => {
    useBuilderStore.getState().loadWidgets([]);
    useBuilderStore.getState().clearGuidedSession();
    useBuilderStore.getState().setMode('manual');
    // A confirmed item now fetches its per-widget live preview; resolve it benignly.
    // An UNCONFIRMED item still fetches nothing (asserted below) — the not-wired case.
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => OK_RESULT,
    } as Response);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the typed "awaiting data / not wired" chart state, not a live chart (Task 4)', () => {
    seedBlueprint([GOVERNED]);
    const { container } = render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);

    const chartArea = container.querySelector('[data-testid="widget-chart-area"]');
    expect(chartArea).toHaveAttribute('data-widget-render-state', 'awaiting_data');
    expect(screen.getByText(/Awaiting data/i)).toBeInTheDocument();
    expect(screen.getByText(/Not wired/i)).toBeInTheDocument();
    // The NL-refine control is present but inert this phase.
    expect(screen.getByText(/Refine runs once data is wired/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('Confirm builds a WidgetSpec via the Phase-3 mapping and appends it — no execution (Task 5)', () => {
    seedBlueprint([GOVERNED]);
    render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);

    expect(useBuilderStore.getState().widgets).toHaveLength(0);
    fireEvent.click(screen.getByTestId('drill-in-confirm'));

    const widgets = useBuilderStore.getState().widgets;
    expect(widgets).toHaveLength(1);
    const w = widgets[0];
    expect(isSemanticWidget(w)).toBe(true);
    if (!isSemanticWidget(w)) throw new Error('expected a semantic widget');

    // Live ID references (Appendix C), the dashboard's model pinned in.
    expect(w.semanticQuery.modelId).toBe('model_1');
    expect(w.semanticQuery.measures).toEqual([{ measureId: 'meas_accidents' }]);
    expect(w.semanticQuery.dimensions).toEqual([{ dimensionId: 'dim_month' }]);
    // measureSnapshots stays EMPTY — re-frozen server-side at save, never computed here.
    expect(w.measureSnapshots).toEqual([]);
    // entityId deferred to first save (client has no catalog to resolve it).
    expect(w.semanticQuery.entityId).toBe('');
    expect(w.chartKind).toBe('line');

    // The blueprint item → widget link is recorded so re-entry patches, not dupes.
    expect(useBuilderStore.getState().guidedSession.drillIn.widgetIdByItemId['bp_governed']).toBe(w.widgetId);
    // Confirmed state is visible.
    expect(screen.getByText(/Added to dashboard/i)).toBeInTheDocument();
    // Confirm is spec-mutation-only: no measureSnapshots were computed here
    // (re-frozen server-side at save). The live-preview fetch that a confirmed
    // item triggers is the render layer's, not part of the confirm mutation —
    // the route contract for that fetch is proven in DrillInStage.data-contract.
  });

  it('re-confirming patches the same widget instead of duplicating', () => {
    seedBlueprint([GOVERNED]);
    render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);
    fireEvent.click(screen.getByTestId('drill-in-confirm'));
    const firstId = useBuilderStore.getState().widgets[0].widgetId;
    // Button now reads "Update chart" and re-clicking patches in place.
    fireEvent.click(screen.getByTestId('drill-in-confirm'));
    expect(useBuilderStore.getState().widgets).toHaveLength(1);
    expect(useBuilderStore.getState().widgets[0].widgetId).toBe(firstId);
  });

  it('an undefined item is not confirmable — never fabricates a widget', () => {
    seedBlueprint([GOVERNED, UNDEFINED_ITEM]);
    render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);

    // Jump to the undefined item via the progress rail.
    const rail = screen.getByTestId('drill-in-rail');
    fireEvent.click(within(rail).getByText('Near-miss rate'));

    expect(screen.queryByTestId('drill-in-confirm')).not.toBeInTheDocument();
    expect(screen.getByText(/Not defined yet — can’t add/i)).toBeInTheDocument();

    // "Accept the rest as-is" confirms only the governed item, never the undefined one.
    fireEvent.click(screen.getByText(/Accept the rest as-is/i));
    const widgets = useBuilderStore.getState().widgets;
    expect(widgets).toHaveLength(1);
    expect(useBuilderStore.getState().guidedSession.drillIn.widgetIdByItemId['bp_undef']).toBeUndefined();
  });

  it('guided→manual→guided preserves populated widgets + confirmed-state under a real re-mount (Task 6)', () => {
    seedBlueprint([GOVERNED]);
    useBuilderStore.getState().setMode('guided');

    function Harness() {
      const mode = useBuilderStore((s) => s.mode);
      return mode === 'guided'
        ? <DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />
        : <div data-testid="manual-grid">manual grid</div>;
    }

    render(<Harness />);
    // Confirm a real widget in guided.
    fireEvent.click(screen.getByTestId('drill-in-confirm'));
    const widgetsAfterConfirm = useBuilderStore.getState().widgets;
    expect(widgetsAfterConfirm).toHaveLength(1);
    const widgetId = widgetsAfterConfirm[0].widgetId;

    // → manual: DrillInStage unmounts, the grid renders, widgets untouched.
    act(() => useBuilderStore.getState().setMode('manual'));
    expect(screen.getByTestId('manual-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('drill-in-stage')).not.toBeInTheDocument();
    expect(useBuilderStore.getState().widgets).toBe(widgetsAfterConfirm); // same reference — lossless

    // → guided: DrillInStage re-mounts. Nothing was dropped.
    act(() => useBuilderStore.getState().setMode('guided'));
    expect(screen.getByTestId('drill-in-stage')).toBeInTheDocument();
    expect(useBuilderStore.getState().widgets).toHaveLength(1);
    expect(useBuilderStore.getState().widgets[0].widgetId).toBe(widgetId);

    // Confirmed-state survived the round-trip (drillIn slice on the shared store).
    const rail = screen.getByTestId('drill-in-rail');
    expect(within(rail).getByText('Accidents over time').closest('button')).toHaveAttribute('data-confirmed', 'true');
    expect(screen.getByText(/Added to dashboard/i)).toBeInTheDocument();
  });
});
