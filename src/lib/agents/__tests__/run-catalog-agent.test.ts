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
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: { agent_catalog: { findFirst: h.findFirst }, platformAgent: { update: vi.fn(async () => ({})) } } }));
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

import { AgentRunError, parseAgentAnswer, runCatalogAgent } from '../run-catalog-agent';

type Loop = {
  systemPrompt: string;
  tools: { tools: { toolSpec: { name: string; inputSchema?: { json: { properties: { values: { required: string[] } } } } } }[] };
  executeTool: (n: string, i: Record<string, unknown>, id: string) => Promise<string>;
  abortSignal: { value: boolean };
  maxLoops: number;
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
      expect(loop.maxLoops).toBe(9);
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
});
