/**
 * Authorization hardening for findings S1–S4 (docs/audits/business-ai-studio-current-state.md):
 *   S1 new users default to member; role grants cannot exceed the caller's own role
 *   S2 workbench sessions are owner-only (reads also allow session:read:all)
 *   S3 policy and catalog writes are admin-only, field-whitelisted, and never trust owner_id from the body
 *   S4 Databricks connection management is admin-only; SQL execute needs inspector:use
 *
 * Only the edges are mocked (NextAuth session, Prisma, audit, Databricks clients). The real
 * resolveAuth → permission flattening → role rank → guard code runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Role = 'platform_admin' | 'admin' | 'member' | 'readonly' | 'custom_ops';
const PERMS: Record<Role, string[]> = {
  platform_admin: ['user:read', 'user:update', 'role:assign', 'session:read', 'session:read:all', 'session:write', 'inspector:use', 'access:admin'],
  admin: ['user:read', 'user:update', 'role:assign', 'session:read', 'session:write', 'inspector:use', 'access:admin'],
  member: ['user:read', 'session:read', 'session:write', 'inspector:use'],
  readonly: ['user:read', 'session:read'],
  custom_ops: ['user:read', 'user:update', 'role:assign', 'inspector:use'],
};

const { db, state, getServerSession, writeAudit } = vi.hoisted(() => {
  const state = {
    caller: 'u-admin' as string | null,
    users: {} as Record<string, string>, // userId → role
    sessionOwners: {} as Record<string, string | null>,
  };
  const userRow = (id: string) => {
    const role = state.users[id];
    if (!role) return null;
    return {
      id, name: id, email: `${id}@example.com`, status: 'ACTIVE', isActive: true, deletedAt: null,
      roles: [{ roleId: `r-${role}`, role: { name: role, permissions: (PERMS_REF.value[role] ?? []).map((key: string) => ({ permission: { key } })) } }],
    };
  };
  const PERMS_REF = { value: {} as Record<string, string[]> };
  const db = {
    PERMS_REF,
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => userRow(where.id)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => userRow(where.id)),
      update: vi.fn(async () => ({})),
    },
    role: { findUnique: vi.fn(async ({ where }: { where: { name: string } }) => ({ id: `r-${where.name}`, name: where.name })) },
    userRole: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) => (state.users[where.userId] ? [{ role: { name: state.users[where.userId] } }] : [])),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
    },
    policy_entry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p-1', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p-1', ...data })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'p-1', name: 'old' })),
    },
    agent_catalog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'a-2', ...data })),
      findUnique: vi.fn(async () => ({ id: 'a-1', name: 'Analyst', slug: 'analyst', type: 'agent', author: 'orig', tags: [], policy_ids: [] })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'a-1', ...data })),
    },
    workbench_sessions: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, user_id: state.sessionOwners[where.id] ?? null, construction_state: null, saved_agent_id: null })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    platform_interaction_search: { deleteMany: vi.fn(async () => ({})) },
    platform_interaction_events: { deleteMany: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
    // session-auth resolves the owner with a tagged-template raw query: values[0] is the session id.
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, id: string) => [{ user_id: state.sessionOwners[id] ?? null }]),
  };
  return {
    db,
    state,
    getServerSession: vi.fn(async () => (state.caller ? { user: { id: state.caller } } : null)),
    writeAudit: vi.fn(async () => {}),
  };
});
db.PERMS_REF.value = PERMS;

vi.mock('@/lib/db', () => ({ prisma: db, default: db }));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/audit', () => ({ writeAudit }));
vi.mock('@/lib/platform/agents', () => ({ getDefaultOrg: async () => ({ id: 'org-1' }) }));
vi.mock('@/lib/construction/load-state', () => ({ loadConstructionState: () => ({}), constructionStateNeedsRepair: () => false }));
vi.mock('@/lib/marcus/dal', () => ({ getPendingReflections: async () => [] }));
vi.mock('@/lib/prompt-snapshot', () => ({ snapshotAgentPrompt: vi.fn(async () => {}) }));
const dbx = vi.hoisted(() => ({ createConnection: vi.fn(), executeDatabricksSQL: vi.fn() }));
vi.mock('@/lib/databricks/connections', () => ({
  getOrgId: async () => 'org-1',
  createConnection: dbx.createConnection,
  updateConnection: vi.fn(),
  listConnections: vi.fn(async () => []),
  getConnection: vi.fn(async (_org: string, id: string) =>
    id === 'c-1' ? { id: 'c-1', status: 'active', workspace_host: 'h', default_warehouse_id: 'w' } : null,
  ),
  deleteConnection: vi.fn(),
}));
vi.mock('@/lib/databricks/secrets', () => ({ writeCredentials: vi.fn() }));
vi.mock('@/lib/databricks/tool-registration', () => ({ syncToolEntry: vi.fn(), deleteToolEntry: vi.fn() }));
vi.mock('@/lib/databricks/token-client', () => ({ getAccessToken: vi.fn(), openDatabricksSession: vi.fn(), evictToken: vi.fn() }));
vi.mock('@/lib/databricks/test-connection', () => ({ testConnection: vi.fn() }));
vi.mock('@/lib/databricks/execute', () => ({
  executeDatabricksSQL: dbx.executeDatabricksSQL,
  ReadOnlyViolationError: class extends Error {},
  MultiStatementError: class extends Error {},
  ExternalLinksError: class extends Error {},
}));
const accessWarehouse = vi.hoisted(() => ({ runWarehouseQuery: vi.fn() }));
vi.mock('@/lib/access/warehouse', () => ({
  runWarehouseQuery: accessWarehouse.runWarehouseQuery,
  runWarehouseExport: vi.fn(),
}));
vi.mock('@/lib/access/principal', () => ({
  principalForUser: vi.fn(async (userId: string) => ({
    kind: 'user',
    orgId: 'org-1',
    userId,
    departmentIds: [],
    clearance: 'internal',
  })),
  systemPrincipal: vi.fn(),
}));

import { DEFAULT_ROLE, canManageRole, roleRank } from '@/lib/rbac';
import { requireRole } from '@/middleware/auth';
import { PATCH as patchUser } from '../users/[id]/route';
import { POST as assignRole, DELETE as revokeRole } from '../access/assignments/route';
import { GET as getSession, PATCH as patchSession, DELETE as deleteSession } from '../agent-lab/workbench/sessions/[id]/route';
import { POST as createPolicy } from '../policies/route';
import { PATCH as patchPolicy } from '../policies/[id]/route';
import { POST as createCatalogAgent } from '../catalog/agents/route';
import { POST as forkCatalogAgent } from '../catalog/agents/[id]/fork/route';
import { POST as createConnection } from '../databricks/connections/route';
import { POST as executeSql } from '../databricks/connections/[id]/execute/route';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const req = (method: string, body?: unknown) =>
  new Request('http://test/api/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (userId: string | null) => {
  state.caller = userId;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.users = { 'u-padmin': 'platform_admin', 'u-admin': 'admin', 'u-member': 'member', 'u-readonly': 'readonly', 'u-custom': 'custom_ops', 'u-other': 'member' };
  state.sessionOwners = { [SESSION_ID]: 'u-member' };
  as('u-admin');
});

describe('S1 — default role and no role escalation', () => {
  it('provisions new users as member and ranks roles', () => {
    expect(DEFAULT_ROLE).toBe('member');
    expect(roleRank('platform_admin')).toBeGreaterThan(roleRank('admin'));
    expect(canManageRole('admin', 'member')).toBe(true);
    expect(canManageRole('admin', 'admin')).toBe(true);
    expect(canManageRole('admin', 'platform_admin')).toBe(false);
    expect(canManageRole('admin', 'custom_ops')).toBe(false); // unknown role being granted ranks highest
    expect(canManageRole('custom_ops', 'readonly')).toBe(false); // unknown caller role ranks lowest
  });

  it('requireRole never lets a custom role stand in for admin', () => {
    expect(() => requireRole({ userId: 'x', role: 'custom_ops', permissions: new Set() }, 'admin')).toThrow('Forbidden');
    expect(() => requireRole({ userId: 'x', role: 'admin', permissions: new Set() }, 'admin')).not.toThrow();
  });

  it('a plain admin can view Users but not change roles (section access, 2026-11-06)', async () => {
    expect((await patchUser(req('PATCH', { role: 'member' }), params('u-other'))).status).toBe(403);
    expect((await assignRole(req('POST', { userId: 'u-other', roleName: 'member' }), undefined)).status).toBe(403);
    expect(db.userRole.deleteMany).not.toHaveBeenCalled();
  });

  describe('with a bundle that gives Manage on Users', () => {
    beforeEach(() => {
      PERMS.admin.push('section:govern.users:manage');
    });
    afterEach(() => {
      PERMS.admin = PERMS.admin.filter((k) => k !== 'section:govern.users:manage');
    });

  it('an admin can set member but cannot grant platform_admin or re-role a platform_admin', async () => {
    expect((await patchUser(req('PATCH', { role: 'member' }), params('u-other'))).status).toBe(200);
    expect((await patchUser(req('PATCH', { role: 'platform_admin' }), params('u-other'))).status).toBe(403);
    expect((await patchUser(req('PATCH', { role: 'member' }), params('u-padmin'))).status).toBe(403);
    expect(db.userRole.deleteMany).toHaveBeenCalledTimes(1); // only the allowed change touched roles
  });

  it('role assignment and revocation are capped at the caller’s own rank', async () => {
    expect((await assignRole(req('POST', { userId: 'u-other', roleName: 'platform_admin' }), undefined)).status).toBe(403);
    expect((await revokeRole(req('DELETE', { userId: 'u-padmin', roleName: 'platform_admin' }), undefined)).status).toBe(403);
    expect((await assignRole(req('POST', { userId: 'u-other', roleName: 'admin' }), undefined)).status).toBe(201);
    as('u-padmin');
    expect((await assignRole(req('POST', { userId: 'u-other', roleName: 'platform_admin' }), undefined)).status).toBe(201);
  });
  });
});

describe('S2 — workbench sessions are owner-only', () => {
  it('rejects non-owners for read, write and delete, and the unauthenticated with 401', async () => {
    as('u-other');
    expect((await getSession(req('GET') as never, params(SESSION_ID))).status).toBe(403);
    expect((await patchSession(req('PATCH', { title: 'x' }) as never, params(SESSION_ID))).status).toBe(403);
    expect((await deleteSession(req('DELETE') as never, params(SESSION_ID))).status).toBe(403);
    expect(db.workbench_sessions.update).not.toHaveBeenCalled();
    expect(db.workbench_sessions.delete).not.toHaveBeenCalled();
    as(null);
    expect((await getSession(req('GET') as never, params(SESSION_ID))).status).toBe(401);
  });

  it('lets the owner read and write', async () => {
    as('u-member');
    expect((await getSession(req('GET') as never, params(SESSION_ID))).status).toBe(200);
    expect((await patchSession(req('PATCH', { title: 'mine' }) as never, params(SESSION_ID))).status).toBe(200);
  });

  it('lets session:read:all read another user’s session but not change it', async () => {
    as('u-padmin');
    expect((await getSession(req('GET') as never, params(SESSION_ID))).status).toBe(200);
    expect((await patchSession(req('PATCH', { title: 'x' }) as never, params(SESSION_ID))).status).toBe(403);
  });
});

describe('S3 — policy and catalog writes', () => {
  it('members and admins cannot write policies; platform admins write only whitelisted fields, with audit', async () => {
    as('u-member');
    expect((await createPolicy(req('POST', { name: 'Cap', type: 'cost_ceiling' }), undefined)).status).toBe(403);
    as('u-admin'); // View on Policies only (section access, 2026-11-06)
    expect((await createPolicy(req('POST', { name: 'Cap', type: 'cost_ceiling' }), undefined)).status).toBe(403);
    as('u-padmin');
    const res = await createPolicy(req('POST', { name: 'Cap', type: 'cost_ceiling', enforcement: 'block', config: { usd: 5 }, id: 'forged', created_at: '1999-01-01', evil: true }), undefined);
    expect(res.status).toBe(201);
    const data = db.policy_entry.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['config', 'enforcement', 'name', 'slug', 'type']);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'policy.created', actorId: 'u-padmin' }));
    expect((await createPolicy(req('POST', { name: 'Cap', type: 'cost_ceiling', enforcement: 'ignore' }), undefined)).status).toBe(400);
    as('u-member');
    expect((await patchPolicy(req('PATCH', { status: 'disabled' }), params('p-1'))).status).toBe(403);
  });

  it('catalog create is admin-only and the owner is always the caller', async () => {
    as('u-member');
    expect((await createCatalogAgent(req('POST', { name: 'X', type: 'agent' }), undefined)).status).toBe(403);
    as('u-admin');
    expect((await createCatalogAgent(req('POST', { name: 'X', type: 'agent', owner_id: 'u-padmin', is_head: true }), undefined)).status).toBe(201);
    const data = db.agent_catalog.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.owner_id).toBe('u-admin');
    expect(data).not.toHaveProperty('is_head');
  });

  it('a fork is owned by the caller and ignores owner_id, author and draft_of_id from the body', async () => {
    as('u-member');
    const res = await forkCatalogAgent(req('POST', { owner_id: 'u-padmin', author: 'someone else', draft_of_id: 'x' }), params('a-1'));
    expect(res.status).toBe(201);
    const data = db.agent_catalog.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ owner_id: 'u-member', author: 'orig', draft_of_id: null, parent_id: 'a-1' });
    as('u-readonly');
    expect((await forkCatalogAgent(req('POST', {}), params('a-1'))).status).toBe(403);
  });
});

describe('S4 — Databricks connections and SQL', () => {
  it('only admins can register a connection; credentials are never written for others', async () => {
    as('u-member');
    const res = await createConnection(req('POST', { name: 'x', workspace_host: 'h', default_warehouse_id: 'w', client_id: 'c', client_secret: 's' }) as never);
    expect(res.status).toBe(403);
    expect(dbx.createConnection).not.toHaveBeenCalled();
  });

  it('SQL execute needs access:admin', async () => {
    as('u-member');
    const res = await executeSql(req('POST', { sql: 'select 1' }) as never, params('c-1'));
    expect(res.status).toBe(403);
    expect(dbx.executeDatabricksSQL).not.toHaveBeenCalled();
    as('u-admin');
    accessWarehouse.runWarehouseQuery.mockResolvedValueOnce({ rows: [], columns: [], row_count: 0, truncated: false });
    const ok = await executeSql(req('POST', { sql: 'select 1' }) as never, params('c-1'));
    expect(ok.status).toBe(200);
    expect(accessWarehouse.runWarehouseQuery).toHaveBeenCalled();
  });
});
