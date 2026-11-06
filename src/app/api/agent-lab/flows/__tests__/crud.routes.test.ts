/**
 * Route contract for save / list / open / version / publish. The service is mocked here (its
 * behaviour is covered in src/lib/flows-store/__tests__/service.test.ts); this checks what the
 * routes add: flag, always-enforced auth, who counts as an actor, and request validation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';

const { resolveAuth, svc } = vi.hoisted(() => ({
  resolveAuth: vi.fn(),
  svc: {
    listFlows: vi.fn(), createFlow: vi.fn(), getFlow: vi.fn(), deleteFlow: vi.fn(),
    saveVersion: vi.fn(), publishFlow: vi.fn(), unpublishFlow: vi.fn(),
  },
}));

vi.mock('@/middleware/auth', () => ({
  resolveAuth,
  requirePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new ApiError(403, 'Forbidden', { required: key });
  },
}));
vi.mock('@/lib/lifecycle/log-agent-cost', () => ({ computeCostUsd: () => 0.033 }));
vi.mock('@/lib/knowledge/service', () => ({ listKnowledgeBases: async () => [{ id: 'kb-sms', name: 'Company SMS', archived: false }] }));
vi.mock('@/lib/agents/catalog', () => ({ agentStatusMap: async () => new Map(), listCatalogAgents: async () => [] }));
vi.mock('@/lib/flows-store/service', () => svc);

import { GET as list, POST as create } from '../route';
import { GET as open, DELETE as remove } from '../[id]/route';
import { POST as saveVersion } from '../[id]/versions/route';
import { POST as publish, DELETE as unpublish } from '../[id]/publish/route';

const member = { userId: 'u-1', role: 'member', permissions: new Set(['inspector:use']) };
const admin = { userId: 'u-9', role: 'platform_admin', permissions: new Set(['inspector:use']) };
const readonly = { userId: 'u-2', role: 'readonly', permissions: new Set(['session:read']) };
const ctx = { params: Promise.resolve({ id: 'f-1' }) };
const post = (body: unknown) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv('DEFAULT_ORG_ID', 'org-1');
  Object.values(svc).forEach((f) => f.mockReset());
  resolveAuth.mockReset().mockResolvedValue(member);
});
afterEach(() => vi.unstubAllEnvs());

describe('flow CRUD routes', () => {
  it('needs a signed-in user with inspector:use', async () => {
    resolveAuth.mockRejectedValueOnce(new ApiError(401, 'Unauthenticated'));
    expect((await list(new Request('http://t/x'), undefined)).status).toBe(401);
    resolveAuth.mockResolvedValueOnce(readonly);
    expect((await create(post({ definition: {} }), undefined)).status).toBe(403);
    expect(svc.createFlow).not.toHaveBeenCalled();
  });

  it('passes the signed-in user, role and org as the actor — never anything from the request body', async () => {
    svc.createFlow.mockResolvedValue({ id: 'f-1' });
    const res = await create(post({ definition: { name: 'x' }, owner: 'someone-else', userId: 'forged' }), undefined);
    expect(res.status).toBe(201);
    expect(svc.createFlow).toHaveBeenCalledWith({ userId: 'u-1', role: 'member', orgId: 'org-1' }, { name: 'x' });
    svc.listFlows.mockResolvedValue([]);
    await list(new Request('http://t/x'), undefined);
    expect(svc.listFlows).toHaveBeenCalledWith({ userId: 'u-1', role: 'member', orgId: 'org-1' });
  });

  it('opens, deletes and saves versions through the service, mapping its errors to status codes', async () => {
    svc.getFlow.mockResolvedValue({ id: 'f-1' });
    expect((await open(new Request('http://t/x'), ctx)).status).toBe(200);
    svc.getFlow.mockRejectedValueOnce(new ApiError(404, 'Flow not found'));
    expect((await open(new Request('http://t/x'), ctx)).status).toBe(404);
    svc.deleteFlow.mockResolvedValue(undefined);
    expect((await remove(new Request('http://t/x', { method: 'DELETE' }), ctx)).status).toBe(204);

    svc.saveVersion.mockResolvedValue({ id: 'f-1', version: 2 });
    expect((await saveVersion(post({ definition: { name: 'x' }, baseVersion: 1 }), ctx)).status).toBe(201);
    expect(svc.saveVersion).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1' }), 'f-1', { name: 'x' }, 1);
    expect((await saveVersion(post({ definition: {} }), ctx)).status).toBe(400); // baseVersion required
    svc.saveVersion.mockRejectedValueOnce(new ApiError(409, 'changed', { latestVersion: 3 }));
    const conflict = await saveVersion(post({ definition: {}, baseVersion: 1 }), ctx);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).details).toEqual({ latestVersion: 3 });
  });

  it('gives platform admins every capability permission for the publish check, and members only their own', async () => {
    svc.publishFlow.mockResolvedValue({ id: 'f-1', status: 'active' });
    resolveAuth.mockResolvedValueOnce(admin);
    expect((await publish(post({ version: 2, inputs: { a: 1 }, fixtures: { s: {} } }), ctx)).status).toBe(200);
    const adminPolicy = svc.publishFlow.mock.calls[0]![1];
    expect([...adminPolicy.permissions].sort()).toEqual(['connector:external', 'connector:write', 'flow:sql', 'inspector:use']);

    await publish(post({ version: 2 }), ctx);
    expect([...svc.publishFlow.mock.calls[1]![1].permissions]).toEqual(['inspector:use']);
    expect(svc.publishFlow.mock.calls[1]![3]).toMatchObject({ version: 2, estimateAgentCostUsd: expect.any(Function) });

    expect((await publish(post({ version: 0 }), ctx)).status).toBe(400);
    svc.unpublishFlow.mockResolvedValue({ id: 'f-1', status: 'draft' });
    expect((await unpublish(new Request('http://t/x', { method: 'DELETE' }), ctx)).status).toBe(200);
  });
});
