import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  agentUseStorageKey,
  getAgentUseChatSnapshot,
  persistAgentUseMessages,
  resetAgentUseChat,
  startAgentUseChat,
  subscribeAgentUseChat,
  type AgentUseChatMessage,
} from '@/lib/agents/agent-use-chat-stream';

describe('agent-use-chat-stream', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
          }),
        },
      })),
    );
  });

  afterEach(() => {
    resetAgentUseChat('test-agent');
    vi.unstubAllGlobals();
  });

  it('keeps streaming after unsubscribe (navigation away)', async () => {
    const slug = 'test-agent';
    const prior: AgentUseChatMessage[] = [];
    startAgentUseChat({
      slug,
      message: 'hello',
      history: [],
      priorMessages: prior,
    });

    const seen: string[] = [];
    const unsub = subscribeAgentUseChat(slug, ({ messages, running }) => {
      const assistant = messages.find((m) => m.role === 'assistant');
      seen.push(`${running}:${assistant?.content ?? ''}`);
    });
    unsub();

    const handle = getAgentUseChatSnapshot(slug);
    expect(handle.running).toBe(true);

    await vi.waitFor(() => {
      expect(getAgentUseChatSnapshot(slug).running).toBe(false);
    });

    const stored = store.get(agentUseStorageKey(slug));
    expect(stored).toBeTruthy();
    persistAgentUseMessages(slug, [{ id: '1', role: 'user', content: 'hello' }]);
    expect(JSON.parse(store.get(agentUseStorageKey(slug))!).length).toBeGreaterThan(0);
  });
  it('tracks live tool calls while running and clears them when done', async () => {
    const slug = 'test-agent';
    const events = [
      { type: 'tool_call_running', callId: 'c1', toolName: 'query_sql' },
      { type: 'tool_call_result', callId: 'c1', durationMs: 40 },
      { type: 'text', delta: 'Done.' },
    ];
    const chunks = events.map((ev) => new TextEncoder().encode(`data: ${JSON.stringify(ev)}

`));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              const value = chunks.shift();
              return value ? { done: false, value } : { done: true, value: undefined };
            },
          }),
        },
      })),
    );

    const seen: string[] = [];
    const unsub = subscribeAgentUseChat(slug, ({ toolCalls, startedAt, running }) => {
      if (running) expect(startedAt).toEqual(expect.any(Number));
      seen.push(toolCalls.map((t) => `${t.toolName}:${t.status}`).join(','));
    });
    startAgentUseChat({ slug, message: 'hi', history: [], priorMessages: [] });

    await vi.waitFor(() => expect(getAgentUseChatSnapshot(slug).running).toBe(false));
    unsub();

    expect(seen).toContain('query_sql:running');
    expect(seen).toContain('query_sql:success');
    const done = getAgentUseChatSnapshot(slug);
    expect(done.toolCalls).toEqual([]);
    expect(done.startedAt).toBeNull();
    expect(done.messages.at(-1)?.content).toBe('Done.');
  });
});
