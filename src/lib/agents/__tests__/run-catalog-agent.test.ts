/**
 * Running a saved agent (shared by agent chat and Automate): only the read-only data tools are
 * offered, answer fields come back typed through submit_answer, and every run records its tokens,
 * outcome and surface and gets a cost. The model loop, tools and database are fakes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  runAgentLoop: vi.fn(),
  flush: vi.fn(),
  executeInspectorTool: vi.fn(),
  knowledgeForAgent: vi.fn(),
  runSearch: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/spend/budgets', () => ({
  assertInteractiveBudget: vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class BudgetExceededError extends Error {},
}));
vi.mock('@/lib/spend/record-spend-event', () => ({
  recordInteractiveLlmSpend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/lifecycle/log-agent-cost', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/lifecycle/log-agent-cost')>();
  return { ...mod, logAgentCost: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('@/lib/db', () => ({ prisma: { agent_catalog: { findFirst: h.findFirst }, platformAgent: { update: vi.fn(async () => ({})) } } }));
vi.mock('@/lib/org', () => ({ getDefaultOrg: () => ({ id: 'org-1' }) }));
vi.mock('@/lib/knowledge/agents', () => ({
  SEARCH_KNOWLEDGE_TOOL: 'search_knowledge',
  knowledgeForAgent: h.knowledgeForAgent,
  searchKnowledgeTool: () => ({ toolSpec: { name: 'search_knowledge' } }),
  knowledgePrompt: (kbs: { name: string }[]) => (kbs.length ? `
KNOWLEDGE: ${kbs.map((k) => k.name).join(', ')}` : ''),
  runSearchKnowledgeTool: h.runSearch,
}));
vi.mock('@/lib/inspector/agent-loop', () => ({ runAgentLoop: h.runAgentLoop }));
vi.mock('@/lib/inspector/providers/factory', () => ({ dispatchAgentLoop: vi.fn() }));
vi.mock('@/lib/inspector/prompts', () => ({
  INSPECTOR_TOOLS: [{ toolSpec: { name: 'describe_schema' } }, { toolSpec: { name: 'execute_tool' } }, { toolSpec: { name: 'save_memory' } }],
}));
vi.mock('@/lib/inspector/tools', () => ({ executeInspectorTool: h.executeInspectorTool, resolveToolCatalogEntry: async () => null }));
vi.mock('@/lib/agent-ops/log-tool-invocation', () => ({ withAgentOpsToolLog: (_m: unknown, _i: unknown, fn: () => Promise<string>) => fn() }));
vi.mock('@/lib/agent-ops/record-turn-metrics', () => ({
  TurnMetricsRecorder: class {
    turnId = 'turn-1';
    constructor(readonly meta: { sessionId: string; surface: string }) {}
    markFirstToken() {}
    addLoop() {}
    flush(p: unknown) {
      h.flush({ meta: this.meta, ...(p as object) });
      return Promise.resolve();
    }
  },
}));
vi.mock('@/lib/construction/prompts', () => ({ buildRuntimeSystemPrompt: () => 'AGENT INSTRUCTIONS' }));
vi.mock('@/lib/construction/catalog-sync', () => ({ runtimeBriefFromCatalog: (a: { config?: { noBrief?: boolean } }) => (a.config?.noBrief ? null : { name: 'x' }) }));
vi.mock('@/lib/construction/workbench-model', () => ({
  resolveWorkbenchModel: () => ({ option: { supportsTools: true }, boostModel: null, effectiveModelId: 'us.amazon.nova-pro-v1:0' }),
}));

import { AGENT_MAX_LOOPS, AgentRunError, parseAgentAnswer, runCatalogAgent } from '../run-catalog-agent';

type Loop = {
  systemPrompt: string;
  tools: { tools: { toolSpec: { name: string; inputSchema?: { json: { properties: { values: { required: string[] } } } } } }[] };
  executeTool: (n: string, i: Record<string, unknown>, id: string) => Promise<string>;
  abortSignal: { value: boolean };
  maxLoops: number;
  onToolCallEvent?: (event: { type: string; callId: string; toolName?: string }) => void;
};
const done = (extra: object = {}) => ({ finalText: '', toolCalls: [], outcome: 'completed', usage: { inputTokens: 20000, outputTokens: 1000 }, loops: 3, ...extra });
const answer = [
  { key: 'compliant', label: 'Compliant', type: 'text' as const, description: 'yes or no' },
  { key: 'next_due', type: 'date' as const, description: 'Next review date' },
  { key: 'open_items', type: 'number' as const, description: 'Open items' },
];

beforeEach(() => {
  h.findFirst.mockReset().mockResolvedValue({ id: 'cat-1', name: 'Regulatory Decision Tracer', status: 'live', config: {} });
  h.runAgentLoop.mockReset();
  h.flush.mockReset();
  h.executeInspectorTool.mockReset().mockResolvedValue('{"rows":[]}');
  h.knowledgeForAgent.mockReset().mockResolvedValue([]);
  h.runSearch.mockReset().mockResolvedValue('{"results":[]}');
});

describe('runCatalogAgent', () => {
  it('offers only the read-only data tools, records the run and prices it', async () => {
    h.runAgentLoop.mockImplementation(async (loop: Loop) => {
      expect(loop.tools.tools.map((t) => t.toolSpec.name)).toEqual(['describe_schema', 'execute_tool']);
      expect(await loop.executeTool('save_memory', {}, 'c0')).toMatch(/not available/);
      await loop.executeTool('execute_tool', { sql: 'select 1' }, 'c1');
      return done({ finalText: 'All good.' });
    });
    const r = await runCatalogAgent({ slug: 'regulatory-decision-tracer', message: 'Check', role: 'member', surface: 'automation' });
    expect(r).toMatchObject({ outcome: 'completed', text: 'All good.', answer: null, toolCalls: 1, loops: 3, turnId: 'turn-1', model: 'us.amazon.nova-pro-v1:0' });
    // Nova Pro: 20k × $0.80/M + 1k × $3.20/M.
    expect(r.costUsd).toBeCloseTo(0.0192, 6);
    expect(h.flush).toHaveBeenCalledWith(expect.objectContaining({ meta: { sessionId: 'cat-1', surface: 'automation' }, outcome: 'completed', toolCalls: 1 }));
  });

  it('takes the answer through submit_answer, types it and stops the loop', async () => {
    h.runAgentLoop.mockImplementation(async (loop: Loop) => {
      expect(loop.systemPrompt).toContain('call submit_answer once with every field (compliant, next_due, open_items)');
      expect(loop.tools.tools.at(-1)!.toolSpec.inputSchema!.json.properties.values.required).toEqual(['compliant', 'next_due', 'open_items']);
      expect(loop.maxLoops).toBe(AGENT_MAX_LOOPS + 1);
      await loop.executeTool('submit_answer', { values: { compliant: 'no', next_due: '2027-02-30', open_items: '1,204', extra: 'x' }, notes: 'Two clauses missing.' }, 'c2');
      expect(loop.abortSignal.value).toBe(true);
      return done({ outcome: 'truncated' });
    });
    const r = await runCatalogAgent({ slug: 's', message: 'Check', role: null, surface: 'automation', answer });
    expect(r.outcome).toBe('completed');
    expect(r.answer).toEqual({
      values: { compliant: 'no', next_due: null, open_items: 1204 },
      missing: ['next_due'],
      issues: { next_due: '"2027-02-30" is not a full date (YYYY-MM-DD)' },
      notes: 'Two clauses missing.',
    });
  });

  it('accepts an answer written as JSON text, and says so when no answer came back', async () => {
    h.runAgentLoop.mockResolvedValueOnce(done({ finalText: '```json\n{"values":{"compliant":"yes","next_due":"2027-01-31","open_items":0}}\n```' }));
    expect((await runCatalogAgent({ slug: 's', message: 'm', role: null, surface: 'automation', answer })).answer!.values).toEqual({ compliant: 'yes', next_due: '2027-01-31', open_items: 0 });
    h.runAgentLoop.mockResolvedValueOnce(done({ finalText: 'I think it is fine.' }));
    const none = await runCatalogAgent({ slug: 's', message: 'm', role: null, surface: 'automation', answer });
    expect(none).toMatchObject({ answer: null, answerProblem: 'The agent did not return the answer fields.', text: 'I think it is fine.' });
  });

  it('refuses unknown agents, agents without instructions and bad answer fields before calling the model', async () => {
    h.findFirst.mockResolvedValueOnce(null);
    await expect(runCatalogAgent({ slug: 'nope', message: 'm', role: null, surface: 'automation' })).rejects.toMatchObject({ status: 404 });
    h.findFirst.mockResolvedValueOnce({ id: 'c', name: 'n', status: 'live', config: { noBrief: true } });
    await expect(runCatalogAgent({ slug: 's', message: 'm', role: null, surface: 'automation' })).rejects.toBeInstanceOf(AgentRunError);
    await expect(runCatalogAgent({ slug: 's', message: 'm', role: null, surface: 'automation', answer: [{ key: 'Bad Key', type: 'text', description: '' }] })).rejects.toMatchObject({ status: 422 });
    expect(h.runAgentLoop).not.toHaveBeenCalled();
  });

  it('records an inspection note for agent chat and does not stream that tool call', async () => {
    const seen: string[] = [];
    h.runAgentLoop.mockImplementation(async (loop: Loop) => {
      expect(loop.systemPrompt).toContain('INSPECTION NOTE');
      expect(loop.tools.tools.map((t) => t.toolSpec.name)).toEqual(['describe_schema', 'execute_tool', 'record_inspection']);
      expect(loop.maxLoops).toBe(AGENT_MAX_LOOPS + 1);
      loop.onToolCallEvent?.({ type: 'tool_call_running', callId: 'c9', toolName: 'record_inspection' });
      await loop.executeTool('record_inspection', { sources: 'a.b.c', joins: 'assumed', caveats: 'one gap' }, 'c9');
      loop.onToolCallEvent?.({ type: 'tool_call_result', callId: 'c9' });
      return done({ finalText: 'Plain answer.' });
    });
    const r = await runCatalogAgent({
      slug: 's',
      message: 'm',
      role: 'admin',
      surface: 'agent_use',
      captureInspection: true,
      onToolCallEvent: (event) => { if ('toolName' in event && event.toolName) seen.push(event.toolName); },
    });
    expect(r.inspection).toEqual({ sources: 'a.b.c', joins: 'assumed', caveats: 'one gap' });
    expect(r.text).toBe('Plain answer.');
    expect(r.toolCalls).toBe(0);
    expect(seen).toEqual([]);
  });

  it('records a failed model call as errored', async () => {
    h.runAgentLoop.mockRejectedValueOnce(new Error('Bedrock throttled'));
    await expect(runCatalogAgent({ slug: 's', message: 'm', role: null, surface: 'agent_use' })).rejects.toThrow('Bedrock throttled');
    expect(h.flush).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'errored', error: 'Bedrock throttled', meta: { sessionId: 'cat-1', surface: 'agent_use' } }));
  });
});

describe('parseAgentAnswer', () => {
  it('ignores junk and keeps every asked field', () => {
    expect(parseAgentAnswer(answer, 'nonsense')).toEqual({ values: { compliant: null, next_due: null, open_items: null }, missing: ['compliant', 'next_due', 'open_items'], issues: {}, notes: null });
  });

  it('gives an agent linked to knowledge a search over what the person running it may see', async () => {
    h.knowledgeForAgent.mockResolvedValue([{ id: 'kb-1', name: 'Company SMS', description: null }]);
    h.runAgentLoop.mockImplementation(async (loop: Loop) => {
      expect(loop.tools.tools.map((t) => t.toolSpec.name)).toEqual(['describe_schema', 'execute_tool', 'search_knowledge']);
      expect(loop.systemPrompt).toContain('KNOWLEDGE: Company SMS');
      await loop.executeTool('search_knowledge', { question: 'fire pump test interval' }, 'c1');
      return done({ finalText: 'Weekly (Company SMS.pdf, p. 12).' });
    });
    const r = await runCatalogAgent({ slug: 'regulatory-decision-tracer', message: 'How often?', role: 'member', surface: 'agent_use', person: { userId: 'u-1', role: 'member' } });
    expect(h.knowledgeForAgent).toHaveBeenCalledWith('cat-1', { userId: 'u-1', role: 'member', orgId: 'org-1' }, 'org-1');
    expect(h.runSearch).toHaveBeenCalledWith({ question: 'fire pump test interval' }, [{ id: 'kb-1', name: 'Company SMS', description: null }], { orgId: 'org-1', userId: 'u-1', surface: 'agent' });
    expect(r).toMatchObject({ toolCalls: 1, knowledgeBases: ['Company SMS'] });
  });

  it('runs without knowledge when the links cannot be read', async () => {
    h.knowledgeForAgent.mockRejectedValue(new Error('relation does not exist'));
    h.runAgentLoop.mockImplementation(async (loop: Loop) => {
      expect(loop.tools.tools.map((t) => t.toolSpec.name)).toEqual(['describe_schema', 'execute_tool']);
      expect(await loop.executeTool('search_knowledge', { question: 'x' }, 'c1')).toMatch(/not available/);
      return done({ finalText: 'ok' });
    });
    const r = await runCatalogAgent({ slug: 'regulatory-decision-tracer', message: 'Hi', role: 'member', surface: 'automation' });
    expect(r.knowledgeBases).toEqual([]);
    expect(h.knowledgeForAgent).toHaveBeenCalledWith('cat-1', null, 'org-1');
  });
});
