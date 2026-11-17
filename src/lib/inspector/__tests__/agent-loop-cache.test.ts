/**
 * Bedrock request shape for prompt caching. The Bedrock client is mocked; we assert on the
 * ConverseStream input each loop actually sends (where the cachePoints are), and that the
 * stored conversation is never polluted with markers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Array<{ input: Record<string, any> }> = [];
let script: Array<'tool' | 'answer'> = [];

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    async send(cmd: { input: Record<string, any> }) {
      sent.push({ input: structuredClone(cmd.input) });
      const kind = script.shift() ?? 'answer';
      async function* stream() {
        if (kind === 'tool') {
          yield { contentBlockStart: { start: { toolUse: { toolUseId: 't1', name: 'lookup' } } } };
          yield { contentBlockDelta: { delta: { toolUse: { input: '{}' } } } };
        } else {
          yield { contentBlockDelta: { delta: { text: 'done' } } };
        }
        yield { metadata: { usage: { inputTokens: 5, outputTokens: 1, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 } } };
      }
      return { stream: stream() };
    }
  },
  ConverseStreamCommand: class { constructor(public input: Record<string, any>) {} },
}));

import { runAgentLoop, type AgentLoopParams } from '../agent-loop';

const base = (over: Partial<AgentLoopParams> = {}): AgentLoopParams => ({
  modelId: 'anthropic.claude-test',
  systemPrompt: 'SYS',
  messages: [{ role: 'user', content: [{ text: 'hi' }] }],
  tools: { tools: [] },
  executeTool: async () => '{"ok":true}',
  maxLoops: 5,
  supportsTools: true,
  supportsThinking: false,
  ...over,
});
const hasCP = (blocks: any[] | undefined) => (blocks ?? []).some((b) => 'cachePoint' in b);

beforeEach(() => { sent.length = 0; script = []; });

describe('cacheConversation', () => {
  it('puts a cachePoint on the system prompt and on the LAST message of every loop', async () => {
    script = ['tool', 'tool', 'answer'];
    const initial = [{ role: 'user' as const, content: [{ text: 'hi' }] }];
    await runAgentLoop(base({ cacheConversation: true, messages: initial }));

    expect(sent).toHaveLength(3);
    for (const { input } of sent) {
      expect(hasCP(input.system)).toBe(true);
      const msgs = input.messages as any[];
      expect(hasCP(msgs[msgs.length - 1].content)).toBe(true);
      // exactly one marker in messages (moving, not accumulating) -> 2 of 4 allowed points total
      expect(msgs.filter((m) => hasCP(m.content))).toHaveLength(1);
    }
    expect(sent[0].input.messages).toHaveLength(1);
    expect(sent[2].input.messages).toHaveLength(5);
    // caller's array is not mutated
    expect(hasCP(initial[0].content)).toBe(false);
  });

  it('adds no cachePoints when disabled', async () => {
    script = ['tool', 'answer'];
    await runAgentLoop(base());
    for (const { input } of sent) {
      expect(hasCP(input.system)).toBe(false);
      expect((input.messages as any[]).some((m) => hasCP(m.content))).toBe(false);
    }
  });

  it('cacheSystemPrompt alone keeps messages unmarked', async () => {
    await runAgentLoop(base({ cacheSystemPrompt: true }));
    expect(hasCP(sent[0].input.system)).toBe(true);
    expect(hasCP(sent[0].input.messages[0].content)).toBe(false);
  });
});
