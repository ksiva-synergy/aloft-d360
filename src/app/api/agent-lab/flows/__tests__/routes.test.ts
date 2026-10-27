/**
 * Contract tests for the Flows preview API: feature flag, always-enforced auth, permission check,
 * request validation, and one full simulate round-trip through the real flow core.
 * Auth and pricing are mocked; nothing touches a database or the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { getFlowTemplate } from '@/lib/flows/templates';

const { resolveAuth } = vi.hoisted(() => ({ resolveAuth: vi.fn() }));

vi.mock('@/middleware/auth', () => ({
  resolveAuth,
  requirePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new ApiError(403, 'Forbidden', { required: key });
  },
}));
vi.mock('@/lib/lifecycle/log-agent-cost', () => ({ computeCostUsd: () => 0.033 }));
vi.mock('@/lib/agents/catalog', () => ({ agentStatusMap: async () => new Map(), listCatalogAgents: async () => [] }));

import { GET as catalogGET } from '../catalog/route';
import { POST as simulatePOST } from '../simulate/route';

const member = { userId: 'u-1', role: 'member', permissions: new Set(['inspector:use', 'session:read']) };
const readonly = { userId: 'u-2', role: 'readonly', permissions: new Set(['session:read']) };

const getCatalog = (query = '') => catalogGET(new Request(`http://test/api/agent-lab/flows/catalog${query}`), undefined);
const simulate = (body: unknown) =>
  simulatePOST(
    new Request('http://test/api/agent-lab/flows/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    undefined,
  );

beforeEach(() => {
  vi.stubEnv('FLOWS_ENABLED', 'true');
  vi.stubEnv('DEFAULT_ORG_ID', 'org-1');
  vi.stubEnv('FLOWS_EGRESS_EMAIL_DOMAINS', 'example.com');
  resolveAuth.mockReset();
  resolveAuth.mockResolvedValue(member);
});
afterEach(() => vi.unstubAllEnvs());

describe('flows preview API', () => {
  it('is hidden unless FLOWS_ENABLED=true, before any auth work', async () => {
    vi.stubEnv('FLOWS_ENABLED', '');
    const res = await getCatalog();
    expect(res.status).toBe(404);
    expect((await res.json()).details).toEqual({ code: 'flows_disabled' });
    expect((await simulate({ definition: {} })).status).toBe(404);
    expect(resolveAuth).not.toHaveBeenCalled();
  });

  it('requires a signed-in user with inspector:use', async () => {
    resolveAuth.mockRejectedValueOnce(new ApiError(401, 'Unauthenticated'));
    expect((await getCatalog()).status).toBe(401);
    resolveAuth.mockResolvedValueOnce(readonly);
    const res = await simulate({ definition: {} });
    expect(res.status).toBe(403);
    expect((await res.json()).details).toEqual({ required: 'inspector:use' });
  });

  it('lists capabilities, templates and goal matches', async () => {
    const res = await getCatalog('?goal=chase%20overdue%20purchase%20orders');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.capabilities.map((c: { id: string }) => c.id)).toEqual(['http.request', 'email.send', 'notify.message', 'object_store.list', 'document.extract']);
    expect(json.templates).toHaveLength(5);
    expect(json.matches[0].templateId).toBe('procurement-po-follow-up');
    expect(json.publishing.available).toBe(true);
  });

  it('simulates a template end to end and reports what blocks publishing for this user', async () => {
    const t = getFlowTemplate('procurement-po-follow-up')!;
    const res = await simulate({ definition: t.definition, inputs: t.sampleInputs, fixtures: t.fixtures });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.simulation.status).toBe('succeeded');
    expect(json.explanation.trigger).toMatch(/purchase-order-updated/);
    // A member may simulate, but sends need connector:external, which is not granted to anyone yet.
    expect(json.findings.filter((f: { code: string }) => f.code === 'missing_permission').map((f: { stepId: string }) => f.stepId)).toEqual([
      'email_supplier',
      'notify_team',
    ]);
    expect(json.readyToPublish).toBe(false);
  });

  it('returns 422 with issues for an invalid definition, 400 for bad JSON, 413 for oversize bodies', async () => {
    const invalid = await simulate({ definition: { name: 'x', steps: [{ id: 'a', type: 'shell', config: {} }] } });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).issues.length).toBeGreaterThan(0);
    expect((await simulate('{not json')).status).toBe(400);
    expect((await simulate({ definition: {}, faults: { a: { failAttempts: 99 } } })).status).toBe(400);
    expect((await simulate(JSON.stringify({ definition: 'x'.repeat(300_000) }))).status).toBe(413);
  });
});
