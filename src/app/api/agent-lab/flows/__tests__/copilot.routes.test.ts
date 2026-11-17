/**
 * Copilot route: the model is mocked; everything after it (parse, apply, validate, policy) is real.
 * Proves the route only ever returns a checked proposal, never saves, and repairs once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { getFlowTemplate } from '@/lib/flows/templates';

const { resolveAuth, proposeFlowEdit, llmConfigured, listConnections, listCatalogAgents } = vi.hoisted(() => ({
  resolveAuth: vi.fn(),
  proposeFlowEdit: vi.fn(),
  llmConfigured: vi.fn(),
  listConnections: vi.fn(),
  listCatalogAgents: vi.fn(),
}));

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
vi.mock('@/lib/knowledge/service', () => ({
  listKnowledgeBases: async () => [
    { id: 'kb-sms', name: 'Company SMS', description: 'Safety management system manual', scope: 'org', documents: 12, archived: false },
    { id: 'kb-old', name: 'Old circulars', description: null, scope: 'org', documents: 3, archived: true },
  ],
}));
vi.mock('@/lib/agents/catalog', () => ({ agentStatusMap: async () => new Map([['regulatory-decision-tracer', { name: 'Regulatory Decision Tracer', status: 'live' }]]), listCatalogAgents }));
vi.mock('@/lib/spend/budgets', () => ({
  assertInteractiveBudget: vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class BudgetExceededError extends Error {},
}));
vi.mock('@/lib/spend/log-llm-turn', () => ({ logInteractiveLlmTurn: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '../copilot/route';

const member = { userId: 'u-1', role: 'member', permissions: new Set(['inspector:use', 'section:build.automate:manage']) };
const copilotUsage = { modelId: 'test-model', usage: { inputTokens: 10, outputTokens: 5 } };
const definition = () => JSON.parse(JSON.stringify(getFlowTemplate('procurement-po-follow-up')!.definition));
const call = (body: unknown) =>
  POST(new Request('http://test/api/agent-lab/flows/copilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), undefined);

beforeEach(() => {
  vi.stubEnv('DEFAULT_ORG_ID', 'org-1');
  resolveAuth.mockReset().mockResolvedValue(member);
  proposeFlowEdit.mockReset();
  llmConfigured.mockReset().mockReturnValue(true);
  listConnections.mockReset().mockResolvedValue([]);
  listCatalogAgents.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('flows copilot API', () => {
  it('needs inspector:use', async () => {
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
    proposeFlowEdit.mockResolvedValue({ kind: 'proposal', reply: 'Removed the approval.', operations: [{ op: 'remove_step', id: 'approve_follow_up' }], ...copilotUsage });
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
    proposeFlowEdit.mockResolvedValue({ kind: 'proposal', reply: 'It runs when the ERP calls the webhook.', operations: [], ...copilotUsage });
    const data = await (await call({ definition: definition(), message: 'when does this run?' })).json();
    expect(data).toEqual({ reply: 'It runs when the ERP calls the webhook.', proposal: null });
  });

  it('asks the model to repair a proposal that does not apply, once, then gives up honestly', async () => {
    proposeFlowEdit
      .mockResolvedValueOnce({ kind: 'proposal', reply: 'x', operations: [{ op: 'update_step', id: 'missing', name: 'y' }], ...copilotUsage })
      .mockResolvedValueOnce({ kind: 'proposal', reply: 'Renamed it.', operations: [{ op: 'set_name', name: 'PO chaser' }], ...copilotUsage });
    const ok = await (await call({ definition: definition(), message: 'rename it' })).json();
    expect(proposeFlowEdit).toHaveBeenCalledTimes(2);
    expect(proposeFlowEdit.mock.calls[1]![0].repairNote).toMatch(/there is no step "missing"/);
    expect(ok.proposal.definition.name).toBe('PO chaser');

    proposeFlowEdit.mockReset().mockResolvedValue({ kind: 'proposal', reply: 'x', operations: [{ op: 'add_step', step: { id: 'bad', type: 'agent', config: {} } }], ...copilotUsage });
    const failed = await (await call({ definition: definition(), message: 'add a step' })).json();
    expect(proposeFlowEdit).toHaveBeenCalledTimes(2);
    expect(failed.proposal).toBeNull();
    expect(failed.problems.length).toBeGreaterThan(0);
  });

  it('reports a failed model call with its reason, and passes the user role for model choice', async () => {
    proposeFlowEdit.mockResolvedValue({ kind: 'error', detail: 'xAI 401: invalid key', ...copilotUsage });
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
    proposeFlowEdit.mockResolvedValue({ kind: 'proposal', reply: 'ok', operations: [], ...copilotUsage });
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

  it('builds a document step with the fields the user listed, and the check catches a bad list', async () => {
    const extract = (fields: unknown) => ({
      op: 'add_step',
      step: { id: 'read_reports', type: 'tool', config: { capability: 'document.extract', input: { connection: 'c-1', key: 'reports/latest.pdf', fields } } },
    });
    proposeFlowEdit.mockResolvedValueOnce({
      kind: 'proposal',
      reply: 'Added a step that reads vessel name, inspection date and deficiencies.',
      operations: [
        extract([
          { key: 'vessel_name', label: 'Vessel name', type: 'text', description: 'Name of the vessel' },
          { key: 'inspection_date', label: 'Inspection date', type: 'date', description: 'Date of the inspection' },
          { key: 'deficiencies', label: 'Deficiencies', type: 'number', description: 'Number of deficiencies recorded' },
        ]),
      ],
      ...copilotUsage,
    });
    const good = await (await call({ definition: definition(), message: 'Vessel name\nInspection date\nNumber of deficiencies' })).json();
    expect(good.proposal.diff.added).toEqual(['read_reports']);
    expect(good.proposal.introduced.filter((f: { stepId?: string; severity: string }) => f.stepId === 'read_reports' && f.severity === 'error')).toEqual([]);

    proposeFlowEdit.mockResolvedValueOnce({ kind: 'proposal', reply: 'Added.', operations: [extract([{ key: 'Vessel', type: 'colour', description: '' }])], ...copilotUsage });
    const bad = await (await call({ definition: definition(), message: 'read the vessel' })).json();
    expect(bad.proposal.introduced.some((f: { code: string; stepId?: string }) => f.code === 'invalid_input' && f.stepId === 'read_reports')).toBe(true);
  });

  it('accepts a long pasted sample and keeps long conversations working', async () => {
    proposeFlowEdit.mockResolvedValue({ kind: 'proposal', reply: 'ok', operations: [], ...copilotUsage });
    const sample = `Fields I need from this report:\n${'Vessel: MV EXAMPLE  IMO 9999999  Port: Example  '.repeat(150)}`;
    expect(sample.length).toBeGreaterThan(4000);
    const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: i === 0 ? sample : `turn ${i}` }));
    const res = await call({ definition: definition(), message: sample, history });
    expect(res.status).toBe(200);
    const sent = proposeFlowEdit.mock.calls[0]![0];
    expect(sent.message).toBe(sample.trim());
    expect(sent.history).toHaveLength(20);
    expect(sent.history.at(-1).text).toBe('turn 29');
    expect((await call({ definition: definition(), message: 'x'.repeat(12_001) })).status).toBe(400);
  });

  it('gives the model the knowledge bases this user may search, not archived ones', async () => {
    proposeFlowEdit.mockResolvedValue({ kind: 'proposal', reply: 'ok', operations: [], ...copilotUsage });
    await call({ definition: definition(), message: 'search the SMS' });
    expect(proposeFlowEdit.mock.calls[0]![0].knowledgeBases).toEqual([{ id: 'kb-sms', name: 'Company SMS', description: 'Safety management system manual', scope: 'org', documents: 12 }]);
  });

  it('gives the model the saved agents, and flags an agent step whose agent does not exist', async () => {
    listCatalogAgents.mockResolvedValue([
      { slug: 'regulatory-decision-tracer', name: 'Regulatory Decision Tracer', description: 'Traces regulatory decisions', status: 'live', runnable: true, tags: [] },
      { slug: 'invoice-harmonization-analyst-mvduxnpr', name: 'Invoice Harmonization Analyst', description: null, status: 'draft', runnable: false, tags: ['finance'] },
    ]);
    const agentStep = (slug: string) => ({ op: 'add_step', step: { id: 'check_rules', type: 'agent', config: { agentSlug: slug, prompt: 'Check this', answer: [{ key: 'compliant', label: 'Compliant', type: 'text', description: 'yes or no' }] } } });
    proposeFlowEdit.mockResolvedValueOnce({ kind: 'proposal', reply: 'Added.', operations: [agentStep('regulatory-decision-tracer')], ...copilotUsage });
    const good = await (await call({ definition: definition(), message: 'check each rule' })).json();
    expect(proposeFlowEdit.mock.calls[0]![0].agents).toEqual([
      { slug: 'regulatory-decision-tracer', name: 'Regulatory Decision Tracer', description: 'Traces regulatory decisions', status: 'live', runnable: true },
      { slug: 'invoice-harmonization-analyst-mvduxnpr', name: 'Invoice Harmonization Analyst', description: null, status: 'draft', runnable: false },
    ]);
    type F = { code: string; stepId?: string };
    expect(good.proposal.introduced.some((f: F) => f.stepId === 'check_rules' && /agent/.test(f.code))).toBe(false);

    proposeFlowEdit.mockResolvedValueOnce({ kind: 'proposal', reply: 'Added.', operations: [agentStep('made-up-agent')], ...copilotUsage });
    const bad = await (await call({ definition: definition(), message: 'check each rule' })).json();
    expect(bad.proposal.introduced).toContainEqual(expect.objectContaining({ code: 'unknown_agent', stepId: 'check_rules' }));
  });

  it('asks again when the model answers in plain text, then passes its text through', async () => {
    proposeFlowEdit.mockResolvedValueOnce({ kind: 'text', reply: 'hmm', ...copilotUsage }).mockResolvedValueOnce({ kind: 'proposal', reply: 'Renamed.', operations: [{ op: 'set_name', name: 'PO chaser' }], ...copilotUsage });
    const first = await (await call({ definition: definition(), message: 'rename it' })).json();
    expect(proposeFlowEdit.mock.calls[1]![0].repairNote).toMatch(/plain text/);
    expect(first.proposal.definition.name).toBe('PO chaser');

    proposeFlowEdit.mockReset().mockResolvedValue({ kind: 'text', reply: 'It runs on a webhook.', ...copilotUsage });
    const second = await (await call({ definition: definition(), message: 'when does it run?' })).json();
    expect(second).toEqual({ reply: 'It runs on a webhook.', proposal: null });
  });
});
