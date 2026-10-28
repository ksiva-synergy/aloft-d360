/**
 * Agent picker list and "Try it" for agent steps: listed for builders only, a prompt still holding
 * {{refs}} is refused before anything runs, a run returns the answer and its cost, and the audit
 * keeps what ran and what it cost, never the prompt or the answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';

const h = vi.hoisted(() => ({ resolveAuth: vi.fn(), runCatalogAgent: vi.fn(), audit: vi.fn(), llm: vi.fn() }));

vi.mock('@/middleware/auth', () => ({
  resolveAuth: h.resolveAuth,
  requirePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) throw new ApiError(403, 'Forbidden', { required: key });
  },
}));
vi.mock('@/lib/lifecycle/log-agent-cost', () => ({ computeCostUsd: () => 0.033 }));
vi.mock('@/lib/audit', () => ({ writeAudit: h.audit }));
vi.mock('@/lib/inspector/llm-configured', () => ({ inspectorLlmConfigured: h.llm }));
vi.mock('@/lib/knowledge/service', () => ({ listKnowledgeBases: async () => [{ id: 'kb-sms', name: 'Company SMS', archived: false }] }));
vi.mock('@/lib/agents/catalog', () => ({
  agentStatusMap: async () => new Map(),
  listCatalogAgents: async () => [{ slug: 'regulatory-decision-tracer', name: 'Regulatory Decision Tracer', description: null, status: 'live', runnable: true, tags: [] }],
}));
vi.mock('@/lib/agents/run-catalog-agent', async () => {
  class AgentRunError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { AgentRunError, runCatalogAgent: h.runCatalogAgent };
});

import { GET as listAgents } from '../agents/route';
import { POST as tryAgent } from '../agent-try/route';
import { AgentRunError } from '@/lib/agents/run-catalog-agent';

const member = { userId: 'u-1', role: 'member', permissions: new Set(['inspector:use']) };
const post = (body: unknown) => tryAgent(new Request('http://test/api/agent-lab/flows/agent-try', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), undefined);
const answer = [{ key: 'compliant', label: 'Compliant', type: 'text', description: 'yes or no' }];

beforeEach(() => {
  vi.stubEnv('FLOWS_ENABLED', 'true');
  vi.stubEnv('DEFAULT_ORG_ID', 'org-1');
  h.resolveAuth.mockReset().mockResolvedValue(member);
  h.runCatalogAgent.mockReset();
  h.audit.mockReset();
  h.llm.mockReset().mockReturnValue(true);
});

describe('agents for automations', () => {
  it('lists saved agents to builders only', async () => {
    expect((await (await listAgents(new Request('http://test/api/agent-lab/flows/agents'), undefined)).json()).agents[0]).toMatchObject({ slug: 'regulatory-decision-tracer', runnable: true });
    h.resolveAuth.mockResolvedValueOnce({ userId: 'v', role: 'readonly', permissions: new Set() });
    expect((await listAgents(new Request('http://test/api/agent-lab/flows/agents'), undefined)).status).toBe(403);
  });

  it('refuses a prompt that still has references, before running anything', async () => {
    const res = await post({ agentSlug: 'regulatory-decision-tracer', prompt: 'Check {{item.voyage}} against {{steps.rules.rows}}' });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Replace {{item.voyage}}, {{steps.rules.rows}} with sample values to try the agent');
    expect(h.runCatalogAgent).not.toHaveBeenCalled();
  });

  it('runs the agent once with the answer fields and audits what it cost, not what it said', async () => {
    h.runCatalogAgent.mockResolvedValue({
      agent: { id: 'cat-1', name: 'Regulatory Decision Tracer', slug: 'regulatory-decision-tracer', status: 'live' },
      model: 'us.amazon.nova-pro-v1:0',
      outcome: 'completed',
      text: 'Voyage V-12 is compliant.',
      answer: { values: { compliant: 'yes' }, missing: [], issues: {}, notes: 'Checked 4 rules.' },
      usage: { inputTokens: 9000, outputTokens: 400 },
      loops: 2,
      toolCalls: 1,
      costUsd: 0.0085,
      durationMs: 4200,
      turnId: 'turn-9',
    });
    const res = await post({ agentSlug: 'regulatory-decision-tracer', prompt: 'Check voyage V-12', answer });
    expect(res.status).toBe(200);
    expect((await res.json()).answer.values).toEqual({ compliant: 'yes' });
    expect(h.runCatalogAgent).toHaveBeenCalledWith(expect.objectContaining({ slug: 'regulatory-decision-tracer', message: 'Check voyage V-12', role: 'member', surface: 'automation', answer }));
    const audited = h.audit.mock.calls[0]![0];
    expect(audited).toMatchObject({ action: 'agent.tried', entityId: 'cat-1', after: { slug: 'regulatory-decision-tracer', costUsd: 0.0085, turnId: 'turn-9' } });
    expect(JSON.stringify(audited)).not.toMatch(/V-12|compliant/);
  });

  it('passes the runner’s reasons through and says when no model is configured', async () => {
    h.runCatalogAgent.mockRejectedValueOnce(new AgentRunError(404, 'Agent not found'));
    const missing = await post({ agentSlug: 'gone', prompt: 'x' });
    expect(missing.status).toBe(404);
    h.llm.mockReturnValue(false);
    expect((await post({ agentSlug: 'gone', prompt: 'x' })).status).toBe(503);
  });
});
