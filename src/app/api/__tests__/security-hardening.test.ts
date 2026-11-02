/**
 * Regression tests for the security assessment remediations (docs/security/SECURITY-ASSESSMENT.md):
 *   F1  workbench session list/delete ignore the forgeable x-user-id header
 *   F2  memory curation is admin-only except for an author's own personal bullets
 *   F3  catalog approval is admin-only, no self-approval, author is server-derived
 *   F4  tool catalog writes are admin-only and field-whitelisted
 *   F5  studio results PATCH is limited to the owning session
 *   F7  LLM batch / harvest routes need an elevated role
 *   F8  status changes cannot target a higher-ranked user or the caller themself
 *   F9  chart delete is owner or admin; chart author is never client-supplied
 *   F10 credentials login locks an account after repeated failures
 *   F14 marcus reflections can only be changed by the session owner
 *   F15 the NEXT_PUBLIC dev-tab flag never grants server-side Agent Ops access
 *
 * Only the edges are mocked (NextAuth session, Prisma, audit, LLM jobs). Real auth and guard code runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Role = 'platform_admin' | 'admin' | 'member' | 'readonly';
const PERMS: Record<Role, string[]> = {
  platform_admin: ['user:read', 'user:update', 'role:assign', 'session:read', 'session:read:all', 'session:write', 'inspector:use'],
  admin: ['user:read', 'user:update', 'role:assign', 'session:read', 'session:write', 'inspector:use'],
  member: ['user:read', 'session:read', 'session:write', 'inspector:use'],
  readonly: ['user:read', 'session:read'],
};

const { db, state, getServerSession, writeAudit, runSynthesisSweep } = vi.hoisted(() => {
  const state = {
    caller: 'u-admin' as string | null,
    users: {} as Record<string, string>,
    sessionOwners: {} as Record<string, string | null>,
    bullet: null as null | { id: string; orgId: string; visibility: string; createdBy: string | null; ruleText: string; status: string },
    chart: null as null | { id: string; org_id: string; created_by: string; deleted_at: null },
    resultSession: null as null | string,
    reflectionSession: null as null | string,
    agentOwner: 'u-member' as string | null,
    passwordHash: '' as string,
  };
  const PERMS_REF = { value: {} as Record<string, string[]> };
  const userRow = (id: string) => {
    const role = state.users[id];
    if (!role) return null;
    return {
      id, name: id, email: `${id}@example.com`, status: 'ACTIVE', isActive: true, deletedAt: null,
      passwordHash: state.passwordHash || null,
      roles: [{ roleId: `r-${role}`, role: { name: role, permissions: (PERMS_REF.value[role] ?? []).map((key: string) => ({ permission: { key } })) } }],
    };
  };
  const db = {
    PERMS_REF,
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        where.id ? userRow(where.id) : userRow(Object.keys(state.users).find((u) => `${u}@example.com` === where.email) ?? '')),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => userRow(where.id)),
      update: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    userRole: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) => (state.users[where.userId] ? [{ role: { name: state.users[where.userId] } }] : [])),
    },
    workbench_sessions: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, user_id: state.sessionOwners[where.id] ?? null })),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    platformAgentMemory: {
      findFirst: vi.fn(async () => state.bullet),
      update: vi.fn(async () => ({ ...state.bullet, helpfulCount: 1 })),
    },
    agent_catalog: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, owner_id: state.agentOwner })),
      update: vi.fn(async () => ({})),
    },
    catalog_review_comments: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c-1', ...data })),
    },
    tool_catalog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 't-1', ...data })),
    },
    studio_query_results: {
      findUnique: vi.fn(async () => (state.resultSession ? { session_id: state.resultSession } : null)),
      update: vi.fn(async () => ({})),
    },
    platform_charts: {
      findFirst: vi.fn(async () => state.chart),
      update: vi.fn(async () => ({})),
    },
    platformMarcusReflection: {
      findUnique: vi.fn(async () => (state.reflectionSession ? { sessionId: state.reflectionSession } : null)),
    },
    $queryRaw: vi.fn(async (_s: TemplateStringsArray, id: string) => [{ user_id: state.sessionOwners[id] ?? null }]),
  };
  return {
    db,
    state,
    getServerSession: vi.fn(async () => (state.caller ? { user: { id: state.caller } } : null)),
    writeAudit: vi.fn(async () => {}),
    runSynthesisSweep: vi.fn(async () => ({ ok: true })),
  };
});
db.PERMS_REF.value = PERMS;

vi.mock('@/lib/db', () => ({ prisma: db, default: db }));
vi.mock('@/lib/prisma', () => ({ prisma: db, default: db }));
vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/audit', () => ({ writeAudit }));
vi.mock('@/lib/platform/agents', () => ({ getDefaultOrg: async () => ({ id: 'org-1' }) }));
vi.mock('@/lib/memory/run-sweep', () => ({ runSynthesisSweep }));
vi.mock('@/lib/context/embed', () => ({ embedQuery: vi.fn(async () => null) }));
vi.mock('@/lib/marcus/dal', () => ({ markDelivered: vi.fn(async () => ({})), resolveReflection: vi.fn(async () => ({})) }));

import { GET as listSessions, DELETE as deleteSessions } from '../agent-lab/workbench/sessions/route';
import { POST as curateBullet } from '../agent-lab/memory/[id]/curate/route';
import { POST as reviewAgent } from '../catalog/agents/[id]/review/route';
import { POST as createTool } from '../catalog/tools/route';
import { PATCH as patchResult } from '../studio/results/route';
import { POST as synthesize } from '../agent-lab/memory/synthesize/route';
import { PATCH as patchUser } from '../users/[id]/route';
import { DELETE as deleteChart } from '../inspector/charts/[chartId]/route';
import { PATCH as patchReflection } from '../agent-lab/marcus/reflections/[id]/route';
import { verifyCredentialsLogin, hashPassword, resetCredentialsThrottle } from '@/lib/auth-credentials';
import { hasAgentOpsRole, canViewAgentOpsRole } from '@/lib/agent-ops/role-gate';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const RESULT_ID = '22222222-2222-4222-8222-222222222222';

const json = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
const nextReq = (url: string, method: string, body?: unknown, headers?: Record<string, string>) => {
  const r = json(url, method, body, headers) as unknown as { nextUrl?: URL };
  Object.defineProperty(r, 'nextUrl', { value: new URL(url) });
  return r as unknown as import('next/server').NextRequest;
};
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  state.caller = 'u-admin';
  state.users = { 'u-pa': 'platform_admin', 'u-admin': 'admin', 'u-member': 'member', 'u-other': 'member', 'u-ro': 'readonly' };
  state.sessionOwners = { [SESSION_A]: 'u-member' };
  state.bullet = null;
  state.chart = null;
  state.resultSession = null;
  state.reflectionSession = null;
  state.agentOwner = 'u-member';
});

describe('F1 workbench sessions identity', () => {
  it('rejects a forged x-user-id header when there is no session', async () => {
    state.caller = null;
    const res = await listSessions(nextReq('http://test/api/agent-lab/workbench/sessions', 'GET', undefined, { 'x-user-id': 'u-pa' }));
    expect(res.status).toBe(401);
    const del = await deleteSessions(nextReq('http://test/api/agent-lab/workbench/sessions', 'DELETE', { ids: [SESSION_A] }, { 'x-user-id': 'u-member' }));
    expect(del.status).toBe(401);
    expect(db.workbench_sessions.deleteMany).not.toHaveBeenCalled();
  });
});

describe('F2 memory curation', () => {
  const curate = (action: string) => curateBullet(json('http://test/x', 'POST', { action }), params({ id: 'b-1' }));

  it('forbids a member from retiring an org bullet', async () => {
    state.caller = 'u-member';
    state.bullet = { id: 'b-1', orgId: 'org-1', visibility: 'org', createdBy: 'u-admin', ruleText: 'r', status: 'ACTIVE' };
    expect((await curate('retire')).status).toBe(403);
    expect(db.platformAgentMemory.update).not.toHaveBeenCalled();
  });

  it("forbids a member from curating another user's personal bullet", async () => {
    state.caller = 'u-member';
    state.bullet = { id: 'b-1', orgId: 'org-1', visibility: 'personal', createdBy: 'u-other', ruleText: 'r', status: 'ACTIVE' };
    expect((await curate('approve')).status).toBe(403);
  });

  it('lets the author curate their own personal bullet and audits it', async () => {
    state.caller = 'u-member';
    state.bullet = { id: 'b-1', orgId: 'org-1', visibility: 'personal', createdBy: 'u-member', ruleText: 'r', status: 'ACTIVE' };
    expect((await curate('approve')).status).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'memory.bullet.approve', actorId: 'u-member' }));
  });

  it('lets an admin curate org bullets', async () => {
    state.bullet = { id: 'b-1', orgId: 'org-1', visibility: 'org', createdBy: null, ruleText: 'r', status: 'ACTIVE' };
    expect((await curate('retire')).status).toBe(200);
  });

  it('rejects unauthenticated callers', async () => {
    state.caller = null;
    expect((await curate('retire')).status).toBe(401);
  });
});

describe('F3 catalog review', () => {
  const review = (body: unknown) => reviewAgent(json('http://test/x', 'POST', body), params({ id: 'a-1' }));

  it('lets a member comment but not approve', async () => {
    state.caller = 'u-member';
    state.agentOwner = 'u-other';
    expect((await review({ body: 'nice' })).status).toBe(201);
    expect((await review({ body: 'ship it', status: 'approve' })).status).toBe(403);
    expect(db.agent_catalog.update).not.toHaveBeenCalled();
  });

  it('blocks an admin from approving their own agent', async () => {
    state.agentOwner = 'u-admin';
    expect((await review({ body: 'ok', status: 'approve' })).status).toBe(403);
  });

  it('derives the author from the session and audits approval', async () => {
    state.agentOwner = 'u-member';
    const res = await review({ body: 'ok', status: 'approve', author: 'Someone Else' });
    expect(res.status).toBe(201);
    expect(db.catalog_review_comments.create).toHaveBeenCalledWith({ data: expect.objectContaining({ author: 'u-admin' }) });
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'catalog_agent.approved' }));
  });
});

describe('F4 tool catalog writes', () => {
  it('forbids members', async () => {
    state.caller = 'u-member';
    const res = await createTool(json('http://test/api/catalog/tools', 'POST', { name: 'T', type: 'sql' }), params({}));
    expect(res.status).toBe(403);
    expect(db.tool_catalog.create).not.toHaveBeenCalled();
  });

  it('lets admins create and strips unknown fields', async () => {
    const res = await createTool(json('http://test/api/catalog/tools', 'POST', { name: 'T', type: 'sql', id: 'evil', created_at: 'x' }), params({}));
    expect(res.status).toBe(201);
    const data = db.tool_catalog.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('created_at');
  });
});

describe('F5 studio results PATCH', () => {
  it("forbids editing a result in another user's session", async () => {
    state.caller = 'u-other';
    state.resultSession = SESSION_A;
    const res = await patchResult(nextReq(`http://test/api/studio/results?id=${RESULT_ID}`, 'PATCH', { specs: [] }));
    expect(res.status).toBe(403);
    expect(db.studio_query_results.update).not.toHaveBeenCalled();
  });

  it('allows the session owner', async () => {
    state.caller = 'u-member';
    state.resultSession = SESSION_A;
    expect((await patchResult(nextReq(`http://test/api/studio/results?id=${RESULT_ID}`, 'PATCH', { specs: [] }))).status).toBe(200);
  });
});

describe('F7 expensive batch routes', () => {
  it('forbids members from running memory synthesis', async () => {
    state.caller = 'u-member';
    expect((await synthesize()).status).toBe(403);
    expect(runSynthesisSweep).not.toHaveBeenCalled();
  });

  it('allows admins', async () => {
    expect((await synthesize()).status).toBe(200);
  });
});

describe('F8 user status changes', () => {
  const patch = (id: string, body: unknown) => patchUser(json(`http://test/api/users/${id}`, 'PATCH', body), params({ id }));

  it('forbids an admin from suspending a platform admin', async () => {
    expect((await patch('u-pa', { status: 'SUSPENDED' })).status).toBe(403);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('forbids suspending yourself', async () => {
    expect((await patch('u-admin', { status: 'SUSPENDED' })).status).toBe(400);
  });

  it('still lets an admin suspend a member', async () => {
    expect((await patch('u-member', { status: 'SUSPENDED' })).status).toBe(200);
  });
});

describe('F9 chart delete', () => {
  const del = () => deleteChart(json('http://test/x', 'DELETE'), params({ chartId: 'ch-1' }));

  it("forbids a member from deleting someone else's chart", async () => {
    state.caller = 'u-other';
    state.chart = { id: 'ch-1', org_id: 'org-1', created_by: 'u-member', deleted_at: null };
    expect((await del()).status).toBe(403);
    expect(db.platform_charts.update).not.toHaveBeenCalled();
  });

  it('lets the owner and admins delete', async () => {
    state.chart = { id: 'ch-1', org_id: 'org-1', created_by: 'u-member', deleted_at: null };
    state.caller = 'u-member';
    expect((await del()).status).toBe(200);
    state.caller = 'u-admin';
    expect((await del()).status).toBe(200);
  });

  it('rejects unauthenticated callers', async () => {
    state.caller = null;
    expect((await del()).status).toBe(401);
  });
});

describe('F14 marcus reflections', () => {
  it("forbids changing a reflection in another user's session", async () => {
    state.caller = 'u-other';
    state.reflectionSession = SESSION_A;
    const res = await patchReflection(json('http://test/x', 'PATCH', { action: 'dismissed' }), params({ id: 'r-1' }));
    expect(res.status).toBe(403);
  });

  it('allows the session owner', async () => {
    state.caller = 'u-member';
    state.reflectionSession = SESSION_A;
    const res = await patchReflection(json('http://test/x', 'PATCH', { action: 'dismissed' }), params({ id: 'r-1' }));
    expect(res.status).toBe(200);
  });
});

describe('F10 credentials throttling', () => {
  it('locks the account after five failures, even for the right password', async () => {
    resetCredentialsThrottle();
    state.passwordHash = await hashPassword('correct-horse');
    for (let i = 0; i < 5; i++) {
      expect(await verifyCredentialsLogin('u-member@example.com', 'wrong')).toBeNull();
    }
    expect(await verifyCredentialsLogin('u-member@example.com', 'correct-horse')).toBeNull();
    resetCredentialsThrottle();
    expect(await verifyCredentialsLogin('u-member@example.com', 'correct-horse')).toMatchObject({ id: 'u-member' });
    state.passwordHash = '';
  }, 60_000);
});

describe('F15 agent ops gate', () => {
  it('ignores NEXT_PUBLIC_ENABLE_DEV_TAB for server-side checks', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEV_TAB', 'true');
    expect(canViewAgentOpsRole('member')).toBe(true);
    expect(hasAgentOpsRole('member')).toBe(false);
    expect(hasAgentOpsRole('admin')).toBe(true);
    vi.unstubAllEnvs();
  });
});
