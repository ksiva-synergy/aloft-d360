/**
 * W1 org-aggregate routes — seeded-fixture unit test.
 *
 * Every earlier check exercised /my-drafts and /my-contributions against ZERO
 * rows (correctly returning empty). The join/grouping/categorization logic that
 * only fires when rows exist had never run. This closes that gap with an
 * in-memory fixture — no DB, no auth flow, no branch dependency.
 *
 * The Prisma mock HONORS the `where` clause (created_by, status, id-in, …) so
 * owner-scoping and status-filtering are genuinely proven: the route only passes
 * if it CONSTRUCTS the right query. A mock that returned rows regardless of
 * `where` would be a false-green.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Smart in-memory Prisma (default export of @/lib/db) ───────────────────────
const { store, db, getServerSession, getUserByEmail, getDefaultOrg, listMyRules } = vi.hoisted(() => {
  const store: Record<string, any[]> = {
    measures: [], dimensions: [], entities: [], models: [], audit: [], charts: [],
  };
  // Minimal Prisma `where` matcher: scalar equality (incl. null) + { in: [...] }.
  const matches = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as any)) return (v as any).in.includes(row[k]);
      return row[k] === v;
    });
  const findMany = (coll: string) => vi.fn(async (args: any) => store[coll].filter((r) => matches(r, args?.where)));
  const db = {
    platform_sem_measures: { findMany: findMany('measures') },
    platform_sem_dimensions: { findMany: findMany('dimensions') },
    platform_sem_entities: { findMany: findMany('entities') },
    platform_semantic_models: { findMany: findMany('models') },
    platform_sem_audit: { findMany: findMany('audit') },
    platform_charts: { findMany: findMany('charts') },
  };
  return {
    store, db,
    getServerSession: vi.fn(),
    getUserByEmail: vi.fn(),
    getDefaultOrg: vi.fn(),
    listMyRules: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ default: db }));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/platform/agents', () => ({ getDefaultOrg }));
vi.mock('@/lib/dashboards/permissions', () => ({ getUserByEmail }));
vi.mock('@/lib/memory/teach', () => ({ listMyRules }));

import { GET as myDraftsGET } from '../my-drafts/route';
import { GET as myContributionsGET } from '../my-contributions/route';

const ORG = 'org-1';
const TEST_USER = 'u-test';
const OTHER_USER = 'u-other';
const MODEL_A = 'model-A';
const MODEL_B = 'model-B';

// Reset the store and default the auth/org mocks to the test user before each test.
beforeEach(() => {
  for (const k of Object.keys(store)) store[k] = [];
  getServerSession.mockResolvedValue({ user: { email: 'test@example.com' } });
  getUserByEmail.mockResolvedValue({ id: TEST_USER, email: 'test@example.com' });
  getDefaultOrg.mockResolvedValue({ id: ORG });
  listMyRules.mockResolvedValue([]);
});

// Seed a realistic multi-model, multi-user fixture. Model A owns entity e-A1
// (2 draft measures for the test user), Model B owns e-B1 (1 draft dimension).
// A different user has a draft on e-A1 (must never surface). The test user also
// has a GOVERNED measure (excluded from drafts, included in contributions).
function seedFixture() {
  store.models = [
    { id: MODEL_A, name: 'Model A', org_id: ORG },
    { id: MODEL_B, name: 'Model B', org_id: ORG },
    { id: 'model-C', name: 'Model C (unreferenced)', org_id: ORG },
  ];
  store.entities = [
    { id: 'e-A1', entity_label: 'Orders',    model_id: MODEL_A, org_id: ORG },
    { id: 'e-B1', entity_label: 'Customers', model_id: MODEL_B, org_id: ORG },
  ];
  store.measures = [
    { id: 'm1', entity_id: 'e-A1', org_id: ORG, created_by: TEST_USER, status: 'draft',
      measure_label: 'Revenue', aggregate: 'sum', metric_type: 'simple', column_name: 'amt',
      expression: null, unit: 'USD', format_hint: null, nl_intent: 'total revenue' },
    { id: 'm2', entity_id: 'e-A1', org_id: ORG, created_by: TEST_USER, status: 'draft',
      measure_label: 'Order Count', aggregate: 'count', metric_type: 'simple', column_name: 'id',
      expression: null, unit: null, format_hint: null, nl_intent: 'how many orders' },
    // test user's GOVERNED measure — excluded from drafts, present in contributions.
    { id: 'm-gov', entity_id: 'e-A1', org_id: ORG, created_by: TEST_USER, status: 'governed',
      measure_label: 'AOV', aggregate: 'avg', metric_type: 'ratio', column_name: null,
      expression: 'x/y', unit: null, format_hint: null, nl_intent: 'average order value' },
    // OTHER user's draft — owner-scoping must exclude it everywhere.
    { id: 'm-other', entity_id: 'e-A1', org_id: ORG, created_by: OTHER_USER, status: 'draft',
      measure_label: 'SECRET', aggregate: 'sum', metric_type: 'simple', column_name: 'z',
      expression: null, unit: null, format_hint: null, nl_intent: 'not yours' },
  ];
  store.dimensions = [
    { id: 'd1', entity_id: 'e-B1', org_id: ORG, created_by: TEST_USER, status: 'draft',
      dimension_label: 'Region', dimension_type: 'categorical', column_name: 'region',
      format_hint: null, nl_intent: 'sales region' },
  ];
}

// ── /my-drafts — multi-model grouping + owner-scoping ─────────────────────────
describe('GET /api/inspector/semantic/my-drafts — populated, multi-model', () => {
  it('groups drafts by model, does not merge or drop, and carries the right modelId', async () => {
    seedFixture();
    const res = await myDraftsGET();
    const body = await res.json();

    // Exactly two groups — one per model that has a draft (grouping actually grouped).
    expect(body.entities).toHaveLength(2);

    const byModel = Object.fromEntries(body.entities.map((g: any) => [g.modelId, g]));
    expect(Object.keys(byModel).sort()).toEqual([MODEL_A, MODEL_B]);

    // Model A: its 2 draft measures, 0 dimensions, correct modelId + name.
    const a = byModel[MODEL_A];
    expect(a.modelId).toBe(MODEL_A);
    expect(a.modelName).toBe('Model A');
    expect(a.measures.map((m: any) => m.id).sort()).toEqual(['m1', 'm2']);
    expect(a.dimensions).toHaveLength(0);

    // Model B: its 1 draft dimension, 0 measures.
    const b = byModel[MODEL_B];
    expect(b.modelId).toBe(MODEL_B);
    expect(b.modelName).toBe('Model B');
    expect(b.dimensions.map((d: any) => d.id)).toEqual(['d1']);
    expect(b.measures).toHaveLength(0);
  });

  it('owner-scopes on populated input — the other user\'s draft never appears', async () => {
    seedFixture();
    const res = await myDraftsGET();
    const body = await res.json();

    const allIds = body.entities.flatMap((g: any) => [
      ...g.measures.map((m: any) => m.id),
      ...g.dimensions.map((d: any) => d.id),
    ]);
    expect(allIds).not.toContain('m-other');
    // And the governed row is excluded from drafts (status filter holds).
    expect(allIds).not.toContain('m-gov');
    expect(allIds.sort()).toEqual(['d1', 'm1', 'm2']);
  });

  it('every returned group carries a modelId that matches its entity\'s real model', async () => {
    seedFixture();
    const res = await myDraftsGET();
    const body = await res.json();
    const entityModel: Record<string, string> = { 'e-A1': MODEL_A, 'e-B1': MODEL_B };
    for (const g of body.entities) {
      expect(g.modelId).toBe(entityModel[g.entityId]);
      expect(typeof g.modelId).toBe('string');
    }
  });

  // Task 4 — regression guard: the previously-proven empty path still holds.
  it('a user with zero drafts returns an empty group list', async () => {
    seedFixture(); // rows exist, but all owned by TEST_USER / OTHER_USER
    getUserByEmail.mockResolvedValue({ id: 'u-empty', email: 'empty@example.com' });
    const res = await myDraftsGET();
    const body = await res.json();
    expect(body.entities).toEqual([]);
  });
});

// ── /my-contributions — sub-category correctness ──────────────────────────────
describe('GET /api/inspector/semantic/my-contributions — populated sub-categories', () => {
  beforeEach(() => {
    seedFixture();
    // One synonym-add audit row (edit touching `synonyms`) + noise rows that must
    // NOT become synonyms: a non-synonym edit, and another user's synonym edit.
    store.audit = [
      { row_id: 'm1', table_name: 'platform_sem_measures', org_id: ORG, changed_by: TEST_USER, action: 'edit',
        created_at: new Date('2026-01-01T00:00:00Z'),
        diff: [{ field: 'synonyms', old: [], new: ['ARR'] }] },
      { row_id: 'm1', table_name: 'platform_sem_measures', org_id: ORG, changed_by: TEST_USER, action: 'edit',
        created_at: new Date('2026-01-02T00:00:00Z'),
        diff: [{ field: 'description', old: 'a', new: 'b' }] }, // not a synonym edit
      { row_id: 'm-other', table_name: 'platform_sem_measures', org_id: ORG, changed_by: OTHER_USER, action: 'edit',
        created_at: new Date('2026-01-03T00:00:00Z'),
        diff: [{ field: 'synonyms', old: [], new: ['NOPE'] }] }, // other user
    ];
    store.charts = [
      { id: 'c1', org_id: ORG, created_by: TEST_USER, chart_source: 'raw_sql', deleted_at: null,
        name: 'My SQL chart', nl_intent: 'raw sql viz', created_at: new Date('2026-01-01T00:00:00Z') },
    ];
    listMyRules.mockResolvedValue([
      { id: 'r1', ruleText: 'exclude internal test accounts', ruleType: 'HARD_RULE', visibility: 'personal', status: 'ACTIVE' },
    ]);
  });

  it('returns all four sub-categories, each populated and correctly separated', async () => {
    const res = await myContributionsGET();
    const body = await res.json();

    // definitions = the test user's measures (incl. governed) + dimensions.
    expect(body.definitions.map((d: any) => d.id).sort()).toEqual(['d1', 'm-gov', 'm1', 'm2']);
    // synonyms = the ONE synonym-add edit; the description edit + other user excluded.
    expect(body.synonyms).toHaveLength(1);
    expect(body.synonyms[0]).toMatchObject({ defId: 'm1', added: ['ARR'] });
    // rules = the taught personal rule.
    expect(body.rules.map((r: any) => r.id)).toEqual(['r1']);
    // charts = the raw-SQL chart.
    expect(body.charts.map((c: any) => c.id)).toEqual(['c1']);
  });

  it('sub-lists do not cross-contaminate (different query sets, not the same feed twice)', async () => {
    const res = await myContributionsGET();
    const body = await res.json();

    const defIds = new Set(body.definitions.map((d: any) => d.id));
    // The chart and rule are NOT definitions.
    expect(defIds.has('c1')).toBe(false);
    expect(defIds.has('r1')).toBe(false);
    // The synonym entry references a def id but is a distinct object with `added`.
    expect(body.synonyms[0]).toHaveProperty('added');
    expect(body.definitions[0]).not.toHaveProperty('added');
    // Owner-scoping across every sub-list: nothing from OTHER_USER.
    expect(defIds.has('m-other')).toBe(false);
    expect(body.synonyms.every((s: any) => s.added.every((x: string) => x !== 'NOPE'))).toBe(true);
  });

  it('a user with no contributions returns four empty sub-lists', async () => {
    getUserByEmail.mockResolvedValue({ id: 'u-empty', email: 'empty@example.com' });
    listMyRules.mockResolvedValue([]);
    const res = await myContributionsGET();
    const body = await res.json();
    expect(body).toEqual({ definitions: [], synonyms: [], rules: [], charts: [] });
  });
});
