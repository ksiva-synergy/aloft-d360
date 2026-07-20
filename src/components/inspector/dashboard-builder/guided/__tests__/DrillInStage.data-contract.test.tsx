// @vitest-environment jsdom
/**
 * THE ROUTE CONTRACT (guided drill-in, Stage 3 integration).
 *
 * There are two data routes, deliberately:
 *   - BATCH   GET .../[dashboardId]/data              → governed-only for everyone
 *             (the shared DashboardViewer's route; it can never render another
 *             user's candidate/draft data).
 *   - PER-WIDGET .../[dashboardId]/widgets/[widgetId]/data → owner-scoped
 *             authoring bypass, confined to the drill-in, guarded per-definition
 *             by the owner-boundary 403 in buildWidgetPreview (GET) /
 *             buildEphemeralWidgetPreview (POST). Phase 5 previews the unsaved
 *             in-progress spec via POST (ephemeral, decision (b)); the batch
 *             route remains forbidden for BOTH methods.
 *
 * The drill-in MUST call the per-widget route and MUST NOT call the batch route.
 * If it ever calls the batch route "because the shell grounded against it for
 * shape", it re-opens the exact draft-leak the owner-boundary test was built to
 * prevent — and that test would NOT catch it, because it guards the per-widget
 * route, not the drill-in's choice of URL. This test is the guard for the seam:
 * a future refactor that points the drill-in at the batch route fails HERE, loudly.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrillInStage } from '../DrillInStage';
import { useBuilderStore } from '../../builder-store';
import { blueprintToWidgetSpec } from '@/lib/dashboards/blueprint-widget';
import type { ChartBlueprint, GuidedBlueprint } from '@/lib/dashboards/guided-types';
import type { ResolvedDefinitions } from '@/lib/dashboards/chart-defaults';
import type { WidgetDataResult } from '@/lib/dashboards/types';

const DASHBOARD_ID = 'dash_contract';
const WIDGET_ID = 'w_confirmed';

const PER_WIDGET_URL = `/api/inspector/dashboards/${DASHBOARD_ID}/widgets/${WIDGET_ID}/data`;
const BATCH_URL = `/api/inspector/dashboards/${DASHBOARD_ID}/data`;

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

const OK_RESULT: WidgetDataResult = {
  status: 'ok',
  rows: [{ month: 'Jan', accident_count: 3 }, { month: 'Feb', accident_count: 5 }],
  sql: 'SELECT month, accident_count FROM governed_view ORDER BY month',
  definitionsUsed: { dimensions: ['dim_month'], measures: ['meas_accidents'] },
  executedAt: '2026-07-20T00:00:00.000Z',
};

/** Seed a governed blueprint with the current item already CONFIRMED — both the
 *  drill-in mapping AND the in-progress WidgetSpec in the shared store, exactly
 *  as `commit` does (appendWidgetSpec + recordDrillInConfirm). The store spec is
 *  what the drill-in previews EPHEMERALLY (POST), so it must be present. */
function seedConfirmed() {
  const bp: GuidedBlueprint = { modelId: 'model_1', modelStatus: 'governed', items: [GOVERNED] };
  const s = useBuilderStore.getState();
  s.loadWidgets([]);
  s.clearGuidedSession();
  s.setMode('guided');
  s.setDashboard(DASHBOARD_ID, 'model_1', 'Safety', 'ver_1');
  s.setBlueprint(bp);
  const spec = blueprintToWidgetSpec(GOVERNED, { modelId: 'model_1', entityId: '', widgetId: WIDGET_ID })!;
  s.appendWidgetSpec(spec);
  s.recordDrillInConfirm(GOVERNED.id, WIDGET_ID);
}

function mockFetch(result: WidgetDataResult, ok = true, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status,
    json: async () => result,
  } as Response);
}

/** Every URL the component fetched, as strings. */
function fetchedUrls(spy: ReturnType<typeof mockFetch>): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

describe('DrillInStage — per-widget route CONTRACT', () => {
  beforeEach(() => seedConfirmed());
  afterEach(() => vi.restoreAllMocks());

  it('THE GATE: drill-in fetches the PER-WIDGET route and NEVER the batch route', async () => {
    const spy = mockFetch(OK_RESULT);
    render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const urls = fetchedUrls(spy);

    // Every call the drill-in made hit the per-widget route…
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain(PER_WIDGET_URL);

    // …and NONE hit the batch route (exact path, or with a query string). This is
    // the line that fails if the drill-in is ever repointed at the batch route.
    for (const u of urls) {
      expect(u === BATCH_URL || u.startsWith(`${BATCH_URL}?`)).toBe(false);
    }
    // The per-widget path is strictly longer — a batch URL is a prefix of it, so
    // assert the widgets segment is actually present (prefix confusion guard).
    expect(urls[0]).toMatch(/\/widgets\/w_confirmed\/data(\?|$)/);
  });

  it('EPHEMERAL (decision b): previews the in-progress spec via POST to the per-widget route, carrying the widget in the body', async () => {
    const spy = mockFetch(OK_RESULT);
    render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);

    await waitFor(() => expect(spy).toHaveBeenCalled());

    // The drill-in POSTs the unsaved spec (never a version-backed GET), so a
    // confirmed-but-unsaved widget previews live instead of 404-ing.
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain(PER_WIDGET_URL);
    expect((init as RequestInit)?.method).toBe('POST');

    // The body carries the in-progress widget spec (this is what makes the
    // preview possible without persisting a version).
    const parsed = JSON.parse((init as RequestInit).body as string);
    expect(parsed.widget).toBeTruthy();
    expect(parsed.widget.widgetId).toBe(WIDGET_ID);
  });

  it('renders the live chart from the per-widget result and populates the SQL trust panel', async () => {
    mockFetch(OK_RESULT);
    const { container } = render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);

    // ok → a live chart, distinct from awaiting_data / empty.
    await waitFor(() => {
      const area = container.querySelector('[data-testid="widget-chart-area"]');
      expect(area).toHaveAttribute('data-widget-render-state', 'ok');
    });
    expect(screen.getByText(/^Live$/i)).toBeInTheDocument();
    expect(container.querySelector('[data-testid="live-chart-svg"]')).toBeTruthy();

    // Source → Compiled SQL slot shows the SQL the per-widget result carried.
    fireEvent.click(screen.getByText(/Compiled SQL/i));
    expect(screen.getByTestId('sql-trust-panel').textContent).toContain('SELECT month, accident_count');
  });

  it('isDraft → the owner-scoped "Draft — not governed" affordance renders beside the chart', async () => {
    mockFetch({ ...OK_RESULT, isDraft: true });
    const { container } = render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="widget-chart-area"]')).toHaveAttribute('data-widget-render-state', 'ok');
    });
    expect(screen.getByTestId('draft-badge')).toBeInTheDocument();
    expect(screen.getByText(/Draft — not governed/i)).toBeInTheDocument();
  });

  it('model_not_governed → the typed "publish to see live data" state (non-owner degrade)', async () => {
    mockFetch({ status: 'model_not_governed', message: 'still a candidate' });
    const { container } = render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="widget-chart-area"]')).toHaveAttribute('data-widget-render-state', 'model_not_governed');
    });
    expect(screen.getByText(/Publish to see live data/i)).toBeInTheDocument();
  });

  it('empty rows → the distinct empty state, never a chart and never not-wired (toAlias false-green guard)', async () => {
    mockFetch({ ...OK_RESULT, rows: [] });
    const { container } = render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="widget-chart-area"]')).toHaveAttribute('data-widget-render-state', 'empty');
    });
    expect(screen.getByText(/No rows for this query/i)).toBeInTheDocument();
    expect(screen.queryByText(/Not wired/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="live-chart-svg"]')).toBeFalsy();
  });

  it('a transport failure → the inspectable error state, never a silent blank', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) } as Response);
    const { container } = render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="widget-chart-area"]')).toHaveAttribute('data-widget-render-state', 'error');
    });
    expect(screen.getByText(/Forbidden/i)).toBeInTheDocument();
  });

  it('NL-refine re-run re-fetches the SAME per-widget route (still never the batch route)', async () => {
    const spy = mockFetch(OK_RESULT);
    render(<DrillInStage modelId="model_1" resolvedDefs={RESOLVED_DEFS} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // The refine control is active once the item is confirmed (wait for the
    // fetch to settle so the button reads "Re-run", not "Re-running…").
    fireEvent.click(await screen.findByText(/^Re-run$/i));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    for (const u of fetchedUrls(spy)) {
      expect(u).toContain(PER_WIDGET_URL);
      expect(u === BATCH_URL || u.startsWith(`${BATCH_URL}?`)).toBe(false);
    }
  });
});
