/**
 * Copilot route: the model is mocked; everything after it (parse, apply, validate, policy) is real.
 * Proves the route only ever returns a checked proposal, never saves, and repairs once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { getFlowTemplate } from '@/lib/flows/templates';

const { resolveAuth, proposeFlowEdit, llmConfigured, listConnections } = vi.hoisted(() => ({ resolveAuth: vi.fn(), proposeFlowEdit: vi.fn(), llmConfigured: vi.fn(), listConnections: vi.fn() }));

vi.mock('@/middleware/auth', () => ({
  resolveAuth,
  requirePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new ApiError(403, 'Forbidden', { required: key });
  },
}));
vi.mock('@/lib/lifecycle/log-agent-cost', () => ({ computeCostUsd: () => 0.033 }));
vi.mock('@/lib/flows-copilot/propose', () => ({ proposeFlowEdit }));
vi.mock('@/lib/inspector/llm-configured', () => ({ inspectorLlmConfigured: llmConfigured }));
vi.mock('@/lib/connections/service', () => ({ listConnections }));

import { POST } from '../copilot/route';

const member = { userId: 'u-1', role: 'member', permissions: new Set(['inspector:use']) };
const definition = () => JSON.parse(JSON.stringify(getFlowTemplate('procurement-po-follow-up')!.definition));
const call = (body: unknown) =>
  POST(new Request('http://test/api/agent-lab/flows/copilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), undefined);

beforeEach(() => {
  vi.stubEnv('FLOWS_ENABLED', 'true');
  vi.stubEnv('DEFAULT_ORG_ID', 'org-1');
  resolveAuth.mockReset().mockResolvedValue(member);
  proposeFlowEdit.mockReset();
  llmConfigured.mockReset().mockReturnValue(true);
  listConnections.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('flows copilot API', () => {
  it('is hidden when Flows is off and needs inspector:use', async () => {
    vi.stubEnv('FLOWS_ENABLED', '');
    expect((await call({ definition: definition(), message: 'hi' })).status).toBe(404);
    vi.stubEnv('FLOWS_ENABLED', 'true');
    resolveAuth.mockResolvedValueOnce({ userId: 'u-2', role: 'readonly', permissions: new Set(['session:read']) });
    expect((await call({ definition: definition(), message: 'hi' })).status).toBe(403);
    expect(proposeFlowEdit).not.toHaveBeenCalled();
  });

  it('says so plainly when no model backend is configured', async () => {
    llmConfigured.mockReturnValue(false);
    const res = await call({ definition: definition(), message: 'run it weekly' });
    expect(res.status).toBe(503);
    expect((await res.json()).details).toEqual({ code: 'copilot_unavailable' });
  });

  it('returns a checked proposal with the diff and the policy findings for this user', async () => {
    proposeFlowEdit.mockResolvedValue({ kind: 'proposal', reply: 'Removed the approval.', operations: [{ op: 'remove_step', id: 'approve_follow_up' }] });
    const res = await call({ definition: definition(), message: 'skip the approval' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toBe('Removed the approval.');
    expect(data.proposal.diff).toEqual({ added: [], removed: ['approve_follow_up'], changed: ['email_supplier'], settings: false });
    // The policy check still runs on the proposal: sending email without an approval is flagged.
    type F = { severity: string; stepId?: string; message: string };
    const missingApproval = (f: F) => f.severity === 'error' && f.stepId === 'email_supplier' && /approval/.test(f.message);
    expect(data.proposal.findings.some(missingApproval)).toBe(true);
    // Only what this change caused is reported as introduced; the draft's existing permission findings are not.
    expect(data.proposal.introduced.some(missingApproval)).toBe(true);
    expect(data.proposal.introduced.some((f: F) => /connector:external/.test(f.message))).toBe(false);
    expect(data.proposal.findings.some((f: F) => /connector:external/.test(f.message))).toBe(true);
  });

  it('answers without a proposal when the model makes no change', async () => {
    proposeFlowEdit.mockResolvedValue({ kind: 'proposal', reply: 'It runs when the ERP calls the webhook.', operations: [] });
    const data = await (await call({ definition: definition(), message: 'when does this run?' })).json();
    expect(data).toEqual({ reply: 'It runs when the ERP calls the webhook.', proposal: null });
  });

  it('asks the model to repair a proposal that does not apply, once, then gives up honestly', async () => {
    proposeFlowEdit
      .mockResolvedValueOnce({ kind: 'proposal', reply: 'x', operations: [{ op: 'update_step', id: 'missing', name: 'y' }] })
      .mockResolvedValueOnce({ kind: 'proposal', reply: 'Renamed it.', operations: [{ op: 'set_name', name: 'PO chaser' }] });
    const ok = await (await call({ definition: definition(), message: 'rename it' })).json();
    expect(proposeFlowEdit).toHaveBeenCalledTimes(2);
    expect(proposeFlowEdit.mock.calls[1]![0].repairNote).toMatch(/there is no step "missing"/);
    expect(ok.proposal.definition.name).toBe('PO chaser');

    proposeFlowEdit.mockReset().mockResolvedValue({ kind: 'proposal', reply: 'x', operations: [{ op: 'add_step', step: { id: 'bad', type: 'agent', config: {} } }] });
    const failed = await (await call({ definition: definition(), message: 'add a step' })).json();
    expect(proposeFlowEdit).toHaveBeenCalledTimes(2);
    expect(failed.proposal).toBeNull();
    expect(failed.problems.length).toBeGreaterThan(0);
  });

  it('reports a failed model call with its reason, and passes the user role for model choice', async () => {
    proposeFlowEdit.mockResolvedValue({ kind: 'error', detail: 'xAI 401: invalid key' });
    const res = await call({ definition: definition(), message: 'rename it' });
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toMatch(/xAI 401: invalid key/);
    expect(data.details).toEqual({ code: 'copilot_model_error' });
    expect(proposeFlowEdit.mock.calls[0]![0].role).toBe('member');
  });

  it('gives the model the connections this user may use (names and kinds only), and copes when they cannot be loaded', async () => {
    listConnections.mockResolvedValue([
      { id: 'c-1', name: 'Crew documents', kind: 's3', status: 'ok', mine: true, config: { bucket: 'crew-docs', region: 'ap-south-1' } },
      { id: 'c-2', name: 'HR site', kind: 'sharepoint', status: 'untested', mine: false, config: { siteUrl: 'https://x.sharepoint.com' } },
    ]);
    proposeFlowEdit.mockResolvedValue({ kind: 'proposal', reply: 'ok', operations: [] });
    await call({ definition: definition(), message: 'read the S3 files' });
    expect(listConnections.mock.calls[0]![0]).toEqual({ userId: 'u-1', role: 'member', orgId: 'org-1' });
    expect(proposeFlowEdit.mock.calls[0]![0].connections).toEqual([
      { id: 'c-1', name: 'Crew documents', kind: 's3', shared: false, status: 'ok' },
      { id: 'c-2', name: 'HR site', kind: 'sharepoint', shared: true, status: 'untested' },
    ]);

    listConnections.mockRejectedValue(new Error('relation "platform_connections" does not exist'));
    const res = await call({ definition: definition(), message: 'read the S3 files' });
    expect(res.status).toBe(200);
    expect(proposeFlowEdit.mock.calls[1]![0].connections).toBeUndefined();
  });

  it('asks again when the model answers in plain text, then passes its text through', async () => {
    proposeFlowEdit.mockResolvedValueOnce({ kind: 'text', reply: 'hmm' }).mockResolvedValueOnce({ kind: 'proposal', reply: 'Renamed.', operations: [{ op: 'set_name', name: 'PO chaser' }] });
    const first = await (await call({ definition: definition(), message: 'rename it' })).json();
    expect(proposeFlowEdit.mock.calls[1]![0].repairNote).toMatch(/plain text/);
    expect(first.proposal.definition.name).toBe('PO chaser');

    proposeFlowEdit.mockReset().mockResolvedValue({ kind: 'text', reply: 'It runs on a webhook.' });
    const second = await (await call({ definition: definition(), message: 'when does it run?' })).json();
    expect(second).toEqual({ reply: 'It runs on a webhook.', proposal: null });
  });
});
