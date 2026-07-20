import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SECURITY CENTERPIECE (issue #2, Task 4). The moment the drill-in can emit
 * live draft rows, the type is capable of leaking one user's ungoverned draft
 * into another user's surface. This suite proves it cannot — with the Phase-3
 * rigor of asserting the ABSENCE of any draft data anywhere in the serialized
 * payload, not merely "a 403 was returned".
 *
 * Runs as pure route logic: mocked dashboard load + role + version + a mocked
 * executeSemanticQuery that reproduces the engine's owner boundary. No live
 * creds (same dark-cred gate as the live-render acceptance item).
 */

// The mock fns are created via vi.hoisted so the (hoisted) vi.mock factories
// below can reference them without hitting the temporal dead zone.
const {
  executeSemanticQuery,
  loadDashboardForExecution,
  getDashboardRole,
  findUnique,
  executeRawSql,
} = vi.hoisted(() => ({
  executeSemanticQuery: vi.fn(),
  loadDashboardForExecution: vi.fn(),
  getDashboardRole: vi.fn(),
  findUnique: vi.fn(),
  executeRawSql: vi.fn(),
}));

// executeSemanticQuery is fully mocked; the real error classes come from the
// node-safe errors module so instanceof matches inside buildWidgetPreview.
vi.mock('@/lib/semantic/execute', () => ({ executeSemanticQuery }));

// Fully mocked (not importOriginal): the real connection.ts pulls in
// `server-only` via platform/agents, which cannot load under vitest. No test
// throws DashboardConnectionUnboundError (the unbound case hits the route's
// inline connectionId guard), so a stub class is sufficient.
vi.mock('@/lib/dashboards/connection', () => ({
  loadDashboardForExecution,
  DashboardConnectionUnboundError: class DashboardConnectionUnboundError extends Error {},
}));

vi.mock('@/lib/dashboards/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dashboards/permissions')>();
  return { ...actual, getDashboardRole };
});

vi.mock('@/lib/db', () => ({
  default: { platform_dashboard_versions: { findUnique } },
}));

vi.mock('@/lib/dashboards/execute-raw-sql', () => ({ executeRawSql }));

import { buildWidgetPreview } from '../widget-preview';
import { SemanticDraftAccessError, SemanticModelNotGovernedError } from '@/lib/semantic/errors';

const DASHBOARD_ID = 'dash-1';
const MODEL_ID = 'model-1';
const CONNECTION_ID = 'conn-1';
const WIDGET_ID = 'widget-1';

const OWNER = { id: 'user-owner' };
const OTHER_EDITOR = { id: 'user-other' };

// A private draft measure owned by OWNER — its id must NEVER surface to anyone else.
const SECRET_DRAFT_MEASURE_ID = 'draft-measure-SECRET-abc123';

/** A semantic widget referencing the owner's private draft measure. */
function semanticWidget() {
  return {
    widgetId: WIDGET_ID,
    title: 'Accident count by root cause',
    chartKind: 'bar',
    chartConfig: {},
    position: { col: 0, row: 0, w: 6, h: 4 },
    measureSnapshots: [],
    semanticQuery: {
      // Deliberately a WRONG stored modelId — the route must defensively pin.
      modelId: 'STALE-model-should-be-overwritten',
      entityId: 'entity-1',
      dimensions: [{ dimensionId: 'dim-1' }],
      measures: [{ measureId: SECRET_DRAFT_MEASURE_ID }],
      filters: [],
      sorts: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadDashboardForExecution.mockResolvedValue({
    dashboardId: DASHBOARD_ID,
    modelId: MODEL_ID,
    connectionId: CONNECTION_ID,
    currentVersionId: 'ver-1',
    visibility: 'shared',
  });
  findUnique.mockResolvedValue({ widgets: [semanticWidget()] });
});

describe('owner boundary — the acceptance gate', () => {
  it('OWNER previewing their own draft gets live rows + isDraft:true', async () => {
    getDashboardRole.mockResolvedValue('owner');
    executeSemanticQuery.mockResolvedValue({
      sql: 'SELECT ...',
      columns: [],
      rows: [{ root_cause_category: 'Fatigue', accident_count: 12 }],
      rowCount: 1,
      isDraft: true,
    });

    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OWNER);

    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'ok', isDraft: true });
    expect((out.body as any).rows).toHaveLength(1);

    // The owner-scoped bypass was applied, with identity from the actor (SEC-2).
    expect(executeSemanticQuery).toHaveBeenCalledTimes(1);
    const [passedQuery, passedConn, passedOpts] = executeSemanticQuery.mock.calls[0];
    expect(passedOpts).toEqual({ authoringMode: true, authoringUserId: OWNER.id });
    expect(passedConn).toBe(CONNECTION_ID);
    // Defensive modelId pin: the stale stored value was overwritten.
    expect(passedQuery.modelId).toBe(MODEL_ID);
  });

  it('a DIFFERENT editor requesting a widget backed by another user\'s draft gets a 403 with NO draft data anywhere', async () => {
    getDashboardRole.mockResolvedValue('editor'); // authorized to author — still must not see another's draft
    executeSemanticQuery.mockRejectedValue(
      new SemanticDraftAccessError('measure', SECRET_DRAFT_MEASURE_ID),
    );

    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OTHER_EDITOR);

    // Typed 403 — a real forbidden access, not a UX state.
    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: 'Forbidden' });

    // ── Assert ABSENCE across the ENTIRE serialized payload (Phase-3 rigor) ──
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(SECRET_DRAFT_MEASURE_ID); // no draft row id
    expect(serialized).not.toContain('isDraft');               // no draft flag
    expect(serialized).not.toContain('rows');                  // no data
    expect(serialized).not.toContain('sql');                   // no query
    expect(serialized.toLowerCase()).not.toContain('draft');   // no mention at all
    // The body carries exactly one key, and it is the generic error.
    expect(Object.keys(out.body)).toEqual(['error']);
  });

  it('the same widget is live for its owner but 403 for the other editor — leak-proof both ways', async () => {
    // Owner: allowed.
    getDashboardRole.mockResolvedValue('owner');
    executeSemanticQuery.mockResolvedValueOnce({
      sql: 'SELECT ...', columns: [], rows: [{ accident_count: 5 }], rowCount: 1, isDraft: true,
    });
    const ownerOut = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OWNER);
    expect(ownerOut.status).toBe(200);
    expect((ownerOut.body as any).isDraft).toBe(true);

    // Other editor: forbidden, no leak.
    getDashboardRole.mockResolvedValue('editor');
    executeSemanticQuery.mockRejectedValueOnce(
      new SemanticDraftAccessError('measure', SECRET_DRAFT_MEASURE_ID),
    );
    const otherOut = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OTHER_EDITOR);
    expect(otherOut.status).toBe(403);
    expect(JSON.stringify(otherOut)).not.toContain(SECRET_DRAFT_MEASURE_ID);
  });
});

describe('bypass is owner-scoped — pure viewers get no authoring opts', () => {
  it('a viewer does NOT receive the authoring bypass (governed-only path)', async () => {
    getDashboardRole.mockResolvedValue('viewer');
    // On the default path the engine blocks a candidate model.
    executeSemanticQuery.mockRejectedValue(
      new SemanticModelNotGovernedError(MODEL_ID, 'candidate'),
    );

    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, { id: 'user-viewer' });

    // executeSemanticQuery was called WITHOUT authoring opts.
    const [, , passedOpts] = executeSemanticQuery.mock.calls[0];
    expect(passedOpts).toBeUndefined();

    // Typed state, not a 500 — and no draft data.
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'model_not_governed' });
    expect(JSON.stringify(out)).not.toContain('isDraft');
    expect(JSON.stringify(out).toLowerCase()).not.toContain('draft — not');
  });
});

describe('governance & connection failures are typed states, never a 500', () => {
  it('model_not_governed for an editor whose engine still blocks (defensive) — no sql when thrown pre-compile', async () => {
    getDashboardRole.mockResolvedValue('editor');
    executeSemanticQuery.mockRejectedValue(
      new SemanticModelNotGovernedError(MODEL_ID, 'archived'),
    );

    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OWNER);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'model_not_governed' });
    expect((out.body as any).sql).toBeUndefined();
  });

  it('an unbound connection returns a typed error state, not a crash', async () => {
    getDashboardRole.mockResolvedValue('owner');
    loadDashboardForExecution.mockResolvedValue({
      dashboardId: DASHBOARD_ID,
      modelId: MODEL_ID,
      connectionId: '', // unbound
      currentVersionId: 'ver-1',
      visibility: 'shared',
    });

    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OWNER);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'error' });
    expect(executeSemanticQuery).not.toHaveBeenCalled();
  });

  it('an unexpected execution error becomes a typed error state', async () => {
    getDashboardRole.mockResolvedValue('owner');
    executeSemanticQuery.mockRejectedValue(new Error('warehouse timeout'));

    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OWNER);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'error', message: 'warehouse timeout' });
  });
});

describe('auth & existence guards', () => {
  it('null actor → 401', async () => {
    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, null);
    expect(out.status).toBe(401);
    expect(executeSemanticQuery).not.toHaveBeenCalled();
  });

  it('missing dashboard → 404', async () => {
    loadDashboardForExecution.mockResolvedValue(null);
    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OWNER);
    expect(out.status).toBe(404);
  });

  it('unknown role (no access) → 403', async () => {
    getDashboardRole.mockResolvedValue(null);
    const out = await buildWidgetPreview(DASHBOARD_ID, WIDGET_ID, OWNER);
    expect(out.status).toBe(403);
    expect(executeSemanticQuery).not.toHaveBeenCalled();
  });

  it('unknown widget id → 404', async () => {
    getDashboardRole.mockResolvedValue('owner');
    const out = await buildWidgetPreview(DASHBOARD_ID, 'no-such-widget', OWNER);
    expect(out.status).toBe(404);
    expect(executeSemanticQuery).not.toHaveBeenCalled();
  });
});
