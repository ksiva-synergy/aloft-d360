/**
 * Copilot model adapter: which model it calls, and how each loop outcome is reported. The agent
 * loops are mocked; this is about routing and outcomes, not model quality.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runAgentLoop, dispatchAgentLoop, hasXai } = vi.hoisted(() => ({ runAgentLoop: vi.fn(), dispatchAgentLoop: vi.fn(), hasXai: vi.fn() }));
vi.mock('@/lib/inspector/agent-loop', () => ({ runAgentLoop }));
vi.mock('@/lib/inspector/providers/factory', () => ({ dispatchAgentLoop }));
vi.mock('@/lib/inspector/llm-configured', async (orig) => ({ ...(await orig<object>()), hasXaiCredentials: hasXai }));

import { proposeFlowEdit, toolCallWrittenAsText } from '../propose';

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
});
