/**
 * Copilot model adapter: which model it calls, and how each loop outcome is reported. The agent
 * loops are mocked; this is about routing and outcomes, not model quality.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runAgentLoop, dispatchAgentLoop, hasXai } = vi.hoisted(() => ({ runAgentLoop: vi.fn(), dispatchAgentLoop: vi.fn(), hasXai: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/inspector/agent-loop', () => ({ runAgentLoop }));
vi.mock('@/lib/inspector/providers/factory', () => ({ dispatchAgentLoop }));
vi.mock('@/lib/inspector/llm-configured', async (orig) => ({ ...(await orig<object>()), hasXaiCredentials: hasXai }));

import { proposeFlowEdit, renderKnowledgeBases, toolCallWrittenAsText } from '../propose';

const def = { name: 'x', steps: [{ id: 'a', type: 'agent', config: { prompt: 'p' } }] };
const done = (extra: object = {}) => ({ finalText: null, toolCalls: [], outcome: 'completed', usage: { inputTokens: 0, outputTokens: 0 }, loops: 1, ...extra });
type Loop = { modelId: string; executeTool: (n: string, i: Record<string, unknown>, id: string) => Promise<string> };

beforeEach(() => {
  runAgentLoop.mockReset();
  dispatchAgentLoop.mockReset();
  hasXai.mockReset();
  vi.stubEnv('FLOWS_COPILOT_MODEL_ID', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('copilot model adapter', () => {
  it('uses Grok when xAI is configured and returns the proposal from the tool call', async () => {
    hasXai.mockReturnValue(true);
    dispatchAgentLoop.mockImplementation(async (model: { key: string }, loop: Loop) => {
      expect(model.key).toBe('grok-xai');
      await loop.executeTool('propose_flow_changes', { reply: 'Done.', operations: [{ op: 'set_name', name: 'y' }] }, 'c1');
      return done();
    });
    const r = await proposeFlowEdit({ definition: def, message: 'rename' });
    expect(r).toEqual({ kind: 'proposal', reply: 'Done.', operations: [{ op: 'set_name', name: 'y' }] });
    expect(runAgentLoop).not.toHaveBeenCalled();
  });

  it('reports the real error when the model call fails, instead of "no proposal"', async () => {
    hasXai.mockReturnValue(true);
    dispatchAgentLoop.mockResolvedValue(done({ outcome: 'errored', errorDetail: 'xAI 401: invalid key' }));
    expect(await proposeFlowEdit({ definition: def, message: 'x' })).toEqual({ kind: 'error', detail: 'xAI 401: invalid key' });
  });

  it('passes a plain-text answer through as text', async () => {
    hasXai.mockReturnValue(true);
    dispatchAgentLoop.mockResolvedValue(done({ finalText: '  It runs on a webhook. ' }));
    expect(await proposeFlowEdit({ definition: def, message: 'when does it run?' })).toEqual({ kind: 'text', reply: 'It runs on a webhook.' });
  });

  it('uses FLOWS_COPILOT_MODEL_ID on Bedrock when set, and falls back to Grok if that call fails', async () => {
    vi.stubEnv('FLOWS_COPILOT_MODEL_ID', 'us.anthropic.some-model');
    hasXai.mockReturnValue(true);
    runAgentLoop.mockImplementation(async (loop: Loop) => {
      expect(loop.modelId).toBe('us.anthropic.some-model');
      return done({ outcome: 'errored', errorDetail: 'AccessDenied' });
    });
    dispatchAgentLoop.mockImplementation(async (_m: unknown, loop: Loop) => {
      await loop.executeTool('propose_flow_changes', { reply: 'ok', operations: [] }, 'c1');
      return done();
    });
    expect(await proposeFlowEdit({ definition: def, message: 'x' })).toEqual({ kind: 'proposal', reply: 'ok', operations: [] });
    expect(dispatchAgentLoop).toHaveBeenCalledTimes(1);
  });

  it('accepts a tool call that the model wrote out as text (seen with Grok), and nothing looser', async () => {
    hasXai.mockReturnValue(true);
    dispatchAgentLoop.mockResolvedValue(done({ finalText: '{"reply":"It runs on a webhook.","operations":[]}' }));
    expect(await proposeFlowEdit({ definition: def, message: 'when?' })).toEqual({ kind: 'proposal', reply: 'It runs on a webhook.', operations: [] });
    expect(toolCallWrittenAsText('```json\n{"reply":"ok","operations":[{"op":"set_name","name":"y"}]}\n```')).toEqual({ kind: 'proposal', reply: 'ok', operations: [{ op: 'set_name', name: 'y' }] });
    expect(toolCallWrittenAsText('Sure! {"reply":"x"}')).toBeNull();
    expect(toolCallWrittenAsText('{"operations":[]}')).toBeNull();
  });

  it('tells the model which connections the user may use, and says so when there are none', async () => {
    hasXai.mockReturnValue(true);
    const prompts: string[] = [];
    dispatchAgentLoop.mockImplementation(async (_m: unknown, loop: Loop & { messages: { content: { text: string }[] }[]; systemPrompt: string }) => {
      prompts.push(loop.messages.at(-1)!.content[0]!.text);
      expect(loop.systemPrompt).toMatch(/forEach: \{ items:/);
      // It knows how to turn a list of wanted values, or a pasted sample, into a document step's own fields.
      expect(loop.systemPrompt).toMatch(/input\.fields = \[\{ key, label, type, description \}\]/);
      expect(loop.systemPrompt).toMatch(/paste a sample of the document text/);
      expect(loop.systemPrompt).toMatch(/send the COMPLETE input object/);
      expect(loop.systemPrompt).not.toMatch(/Crew documents/); // per-request data stays out of the cached prompt
      return done();
    });
    await proposeFlowEdit({ definition: def, message: 'x', connections: [{ id: 'c-1', name: 'Crew documents', kind: 's3', shared: false, status: 'ok' }, { id: 'c-2', name: 'HR', kind: 'sharepoint', shared: true, status: 'error' }] });
    await proposeFlowEdit({ definition: def, message: 'x', connections: [] });
    await proposeFlowEdit({ definition: def, message: 'x' });
    expect(prompts[0]).toContain('- id "c-1": "Crew documents" (Amazon S3)');
    expect(prompts[0]).toContain('- id "c-2": "HR" (SharePoint, shared by a colleague, failing its test)');
    expect(prompts[1]).toContain('AVAILABLE CONNECTIONS: none yet');
    expect(prompts[2]).toContain('AVAILABLE CONNECTIONS: (could not be loaded');
  });

  it('tells the model which saved agents exist and which can only be tried', async () => {
    hasXai.mockReturnValue(true);
    const prompts: string[] = [];
    dispatchAgentLoop.mockImplementation(async (_m: unknown, loop: Loop & { messages: { content: { text: string }[] }[]; systemPrompt: string }) => {
      prompts.push(loop.messages.at(-1)!.content[0]!.text);
      expect(loop.systemPrompt).toMatch(/Use a saved agent from AVAILABLE AGENTS/);
      expect(loop.systemPrompt).toMatch(/\{\{steps\.<id>\.values\.<key>\}\}/);
      return done();
    });
    await proposeFlowEdit({
      definition: def,
      message: 'x',
      agents: [
        { slug: 'regulatory-decision-tracer', name: 'Regulatory Decision Tracer', description: 'Traces regulatory decisions', status: 'live', runnable: true },
        { slug: 'invoice-harmonization-analyst', name: 'Invoice Harmonization Analyst', description: null, status: 'draft', runnable: false },
      ],
    });
    await proposeFlowEdit({ definition: def, message: 'x' });
    expect(prompts[0]).toContain('- agentSlug "regulatory-decision-tracer": "Regulatory Decision Tracer" (live) — Traces regulatory decisions');
    expect(prompts[0]).toContain('- agentSlug "invoice-harmonization-analyst": "Invoice Harmonization Analyst" (draft, can be tried but not published)');
    expect(prompts[1]).toContain('AVAILABLE AGENTS: (could not be loaded');
  });
});

describe('knowledge bases in the copilot message', () => {
  it('lists ids, names and what is in them, and says what to do when there are none', () => {
    expect(renderKnowledgeBases([{ id: 'kb-sms', name: 'Company SMS', description: 'SMS manual and forms', scope: 'org', documents: 12 }])).toBe(
      'AVAILABLE KNOWLEDGE BASES (a retrieve step searches these; use the id):\n- id "kb-sms": "Company SMS" (organisation, 12 documents ready) — SMS manual and forms',
    );
    expect(renderKnowledgeBases([])).toMatch(/none yet \(use "CHOOSE_KNOWLEDGE"/);
    expect(renderKnowledgeBases(undefined)).toMatch(/could not be loaded/);
  });
});
