import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SECURITY CENTERPIECE for decision (b) — the EPHEMERAL authoring-preview
 * (Phase 5). `buildEphemeralWidgetPreview` executes a REQUEST-SUPPLIED, unsaved
 * widget spec so a confirmed-but-unsaved guided chart can render live during the
 * drill-in. That is exactly the moment a client-supplied spec could (a) leak
 * another user's ungoverned draft, (b) point at a foreign model, or (c) persist
 * something it shouldn't. This suite proves none of those happen — with the same
 * Phase-3 rigor as the version-backed owner-boundary suite: assert the ABSENCE of
 * draft data anywhere in the serialized payload, and assert NOTHING is persisted.
 *
 * Runs as pure route logic: mocked dashboard load + role + a mocked
 * executeSemanticQuery that reproduces the engine's owner boundary, plus mocked
 * definition tables for the server-side entity resolution. No live creds.
 */

const {
  executeSemanticQuery,
  loadDashboardForExecution,
  getDashboardRole,
  measuresFindMany,
  dimensionsFindMany,
  versionCreate,
  auditCreate,
} = vi.hoisted(() => ({
  executeSemanticQuery: vi.fn(),
  loadDashboardForExecution: vi.fn(),
  getDashboardRole: vi.fn(),
  measuresFindMany: vi.fn(),
  dimensionsFindMany: vi.fn(),
  versionCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/semantic/execute', () => ({ executeSemanticQuery }));

vi.mock('@/lib/dashboards/connection', () => ({
  loadDashboardForExecution,
  DashboardConnectionUnboundError: class DashboardConnectionUnboundError extends Error {},
}));

vi.mock('@/lib/dashboards/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dashboards/permissions')>();
  return { ...actual, getDashboardRole };
});

// The db mock backs BOTH the entity resolver (sem tables) and the
// nothing-persisted assertions (version/audit create must never fire).
vi.mock('@/lib/db', () => ({
  default: {
    platform_sem_measures: { findMany: measuresFindMany },
    platform_sem_dimensions: { findMany: dimensionsFindMany },
    platform_dashboard_versions: { create: versionCreate },
    platform_dashboard_audit: { create: auditCreate },
  },
}));

import { buildEphemeralWidgetPreview } from '../widget-preview';
import { SemanticDraftAccessError, SemanticModelNotGovernedError } from '@/lib/semantic/errors';
import type { WidgetSpec } from '../types';

const DASHBOARD_ID = 'dash-1';
const MODEL_ID = 'model-1';
const CONNECTION_ID = 'conn-1';
const ORG_ID = 'org-1';
const WIDGET_ID = 'widget-eph';
const RESOLVED_ENTITY_ID = 'entity-resolved';

const OWNER = { id: 'user-owner' };
const OTHER_EDITOR = { id: 'user-other' };

const SECRET_DRAFT_MEASURE_ID = 'draft-measure-SECRET-abc123';

/** An in-progress GUIDED spec: entityId DEFERRED ('') + a STALE modelId, exactly
 *  as the drill-in produces it. The server must pin the model and resolve the
 *  entity — never trust either from the body. */
function ephemeralWidget(): WidgetSpec {
  return {
    widgetId: WIDGET_ID,
    title: 'Accident count by root cause',
    chartKind: 'bar',
    chartConfig: {},
    position: { col: 0, row: 0, w: 6, h: 4 },
    measureSnapshots: [],
    semanticQuery: {
      modelId: 'STALE-model-should-be-overwritten',
      entityId: '', // ← deferred; resolved server-side
      dimensions: [{ dimensionId: 'dim-1' }],
      measures: [{ measureId: SECRET_DRAFT_MEASURE_ID }],
      filters: [],
      sorts: [],
    },
  };
}

function rawSqlWidget(): WidgetSpec {
  return {
    widgetId: WIDGET_ID,
    title: 'Raw',
    chartKind: 'bar',
    chartConfig: {},
    position: { col: 0, row: 0, w: 6, h: 4 },
    chartSource: 'raw_sql',
    rawSql: 'SELECT 1',
    resultSchema: [],
    connectionId: 'FOREIGN-conn',
  };
}

function expectNothingPersisted() {
  expect(versionCreate).not.toHaveBeenCalled();
  expect(auditCreate).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  loadDashboardForExecution.mockResolvedValue({
    dashboardId: DASHBOARD_ID,
    orgId: ORG_ID,
    modelId: MODEL_ID,
    connectionId: CONNECTION_ID,
    currentVersionId: 'ver-1',
    visibility: 'shared',
  });
  // Server-side entity resolution: the deferred entityId resolves from the
  // referenced measure/dimension.
  measuresFindMany.mockResolvedValue([{ id: SECRET_DRAFT_MEASURE_ID, entity_id: RESOLVED_ENTITY_ID }]);
  dimensionsFindMany.mockResolvedValue([{ id: 'dim-1', entity_id: RESOLVED_ENTITY_ID }]);
});

describe('ephemeral owner boundary — the acceptance gate', () => {
  it('OWNER previewing their own in-progress spec gets live rows + isDraft; model pinned, entity resolved, nothing persisted', async () => {
    getDashboardRole.mockResolvedValue('owner');
    executeSemanticQuery.mockResolvedValue({
      sql: 'SELECT ...', columns: [], rows: [{ root_cause_category: 'Fatigue', accident_count: 12 }], rowCount: 1, isDraft: true,
    });

    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), OWNER);

    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'ok', isDraft: true });
    expect((out.body as any).rows).toHaveLength(1);

    // Owner-scoped bypass applied, identity from the actor (SEC-2).
    expect(executeSemanticQuery).toHaveBeenCalledTimes(1);
    const [passedQuery, passedConn, passedOpts] = executeSemanticQuery.mock.calls[0];
    expect(passedOpts).toEqual({ authoringMode: true, authoringUserId: OWNER.id });
    expect(passedConn).toBe(CONNECTION_ID);
    // Defensive model pin + server-side entity binding.
    expect(passedQuery.modelId).toBe(MODEL_ID);
    expect(passedQuery.entityId).toBe(RESOLVED_ENTITY_ID);

    expectNothingPersisted();
  });

  it('a DIFFERENT editor whose spec references another user\'s draft gets a 403 with NO draft data anywhere, and persists nothing', async () => {
    getDashboardRole.mockResolvedValue('editor');
    executeSemanticQuery.mockRejectedValue(new SemanticDraftAccessError('measure', SECRET_DRAFT_MEASURE_ID));

    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), OTHER_EDITOR);

    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: 'Forbidden' });

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(SECRET_DRAFT_MEASURE_ID);
    expect(serialized).not.toContain('isDraft');
    expect(serialized).not.toContain('rows');
    expect(serialized).not.toContain('sql');
    expect(serialized.toLowerCase()).not.toContain('draft');
    expect(Object.keys(out.body)).toEqual(['error']);

    expectNothingPersisted();
  });
});

describe('ephemeral is authoring-only — tighter than the version-backed route', () => {
  it('a VIEWER (canView but not canEdit) is refused 403 BEFORE any execution', async () => {
    getDashboardRole.mockResolvedValue('viewer');

    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), { id: 'user-viewer' });

    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: 'Forbidden' });
    expect(executeSemanticQuery).not.toHaveBeenCalled();
    expectNothingPersisted();
  });

  it('an org_member (view-only synthetic role) is refused 403', async () => {
    getDashboardRole.mockResolvedValue('org_member');
    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), { id: 'user-x' });
    expect(out.status).toBe(403);
    expect(executeSemanticQuery).not.toHaveBeenCalled();
  });
});

describe('ephemeral refuses raw-SQL (no client-supplied SQL/connection surface)', () => {
  it('a raw-SQL spec is rejected 400 before execution — the foreign connection never runs', async () => {
    getDashboardRole.mockResolvedValue('owner');
    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, rawSqlWidget(), OWNER);
    expect(out.status).toBe(400);
    expect(executeSemanticQuery).not.toHaveBeenCalled();
    expectNothingPersisted();
  });
});

describe('governance & connection failures are typed states, never a 500', () => {
  it('an editor whose engine still blocks the model → typed model_not_governed (defensive)', async () => {
    getDashboardRole.mockResolvedValue('editor');
    executeSemanticQuery.mockRejectedValue(new SemanticModelNotGovernedError(MODEL_ID, 'candidate'));

    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), OWNER);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'model_not_governed' });
    expect((out.body as any).sql).toBeUndefined();
  });

  it('an unbound connection returns a typed error state, not a crash', async () => {
    getDashboardRole.mockResolvedValue('owner');
    loadDashboardForExecution.mockResolvedValue({
      dashboardId: DASHBOARD_ID, orgId: ORG_ID, modelId: MODEL_ID, connectionId: '', currentVersionId: 'ver-1', visibility: 'shared',
    });

    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), OWNER);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'error' });
    expect(executeSemanticQuery).not.toHaveBeenCalled();
  });

  it('an unexpected execution error becomes a typed error state', async () => {
    getDashboardRole.mockResolvedValue('owner');
    executeSemanticQuery.mockRejectedValue(new Error('warehouse timeout'));

    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), OWNER);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'error', message: 'warehouse timeout' });
  });
});

describe('auth & existence guards', () => {
  it('null actor → 401', async () => {
    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), null);
    expect(out.status).toBe(401);
    expect(executeSemanticQuery).not.toHaveBeenCalled();
  });

  it('missing dashboard → 404', async () => {
    loadDashboardForExecution.mockResolvedValue(null);
    const out = await buildEphemeralWidgetPreview(DASHBOARD_ID, ephemeralWidget(), OWNER);
    expect(out.status).toBe(404);
    expect(executeSemanticQuery).not.toHaveBeenCalled();
  });
});
