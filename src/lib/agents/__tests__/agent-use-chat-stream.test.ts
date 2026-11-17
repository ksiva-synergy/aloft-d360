import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  getAgentUseChatSnapshot,
  openAgentUseChat,
  resetAgentUseChat,
  startAgentUseChat,
  subscribeAgentUseChat,
} from '@/lib/agents/agent-use-chat-stream';

function streamOf(events: object[]) {
  const chunks = events.map((ev) => new TextEncoder().encode(`data: ${JSON.stringify(ev)}\n\n`));
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          const value = chunks.shift();
          return value ? { done: false, value } : { done: true, value: undefined };
        },
      }),
    },
  }));
}

const slug = 'test-agent';
const CHAT_ID = '11111111-1111-4111-8111-111111111111';

describe('agent-use-chat-stream', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', streamOf([]));
  });

  afterEach(() => {
    resetAgentUseChat(slug);
    vi.unstubAllGlobals();
  });

  it('keeps streaming after unsubscribe (navigation away) and keeps the chat in memory', async () => {
    startAgentUseChat({ slug, chatId: null, message: 'hello', priorMessages: [] });
    const unsub = subscribeAgentUseChat(slug, () => {});
    unsub();

    expect(getAgentUseChatSnapshot(slug).running).toBe(true);
    await vi.waitFor(() => expect(getAgentUseChatSnapshot(slug).running).toBe(false));
    expect(getAgentUseChatSnapshot(slug).messages.map((m) => m.content)).toEqual(['hello']);
  });

  it('sends only the chat id and new message (history comes from the server), and adopts the new chat id', async () => {
    const fetchMock = streamOf([{ type: 'chat', chatId: CHAT_ID }, { type: 'text', delta: 'Hi!' }, { type: 'done' }]);
    vi.stubGlobal('fetch', fetchMock);
    const onSettled = vi.fn();

    startAgentUseChat({ slug, chatId: null, message: 'hello', priorMessages: [], model: 'm-1', onSettled });
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledWith(CHAT_ID));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({ slug, message: 'hello', chatId: null, model: 'm-1', turnId: expect.any(String) });
    const snap = getAgentUseChatSnapshot(slug);
    expect(snap.chatId).toBe(CHAT_ID);
    expect(snap.messages.map((m) => `${m.role}:${m.content}`)).toEqual(['user:hello', 'assistant:Hi!']);
  });

  it('continues an opened saved chat', async () => {
    const fetchMock = streamOf([{ type: 'chat', chatId: CHAT_ID }, { type: 'text', delta: 'Again.' }]);
    vi.stubGlobal('fetch', fetchMock);
    openAgentUseChat(slug, CHAT_ID, [
      { id: 'a', role: 'user', content: 'earlier' },
      { id: 'b', role: 'assistant', content: 'ok' },
    ]);
    const opened = getAgentUseChatSnapshot(slug);
    expect(opened.chatId).toBe(CHAT_ID);

    startAgentUseChat({ slug, chatId: opened.chatId, message: 'more', priorMessages: opened.messages });
    await vi.waitFor(() => expect(getAgentUseChatSnapshot(slug).running).toBe(false));

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).chatId).toBe(CHAT_ID);
    expect(getAgentUseChatSnapshot(slug).messages.map((m) => m.content)).toEqual(['earlier', 'ok', 'more', 'Again.']);
  });

  it('New chat clears the open chat', () => {
    openAgentUseChat(slug, CHAT_ID, [{ id: 'a', role: 'user', content: 'earlier' }]);
    resetAgentUseChat(slug);
    expect(getAgentUseChatSnapshot(slug)).toMatchObject({ chatId: null, messages: [], running: false });
  });

  it('tracks live tool calls while running and clears them when done', async () => {
    vi.stubGlobal(
      'fetch',
      streamOf([
        { type: 'tool_call_running', callId: 'c1', toolName: 'query_sql' },
        { type: 'tool_call_result', callId: 'c1', durationMs: 40 },
        { type: 'text', delta: 'Done.' },
      ]),
    );

    const seen: string[] = [];
    const unsub = subscribeAgentUseChat(slug, ({ toolCalls, startedAt, running }) => {
      if (running) expect(startedAt).toEqual(expect.any(Number));
      seen.push(toolCalls.map((t) => `${t.toolName}:${t.status}`).join(','));
    });
    startAgentUseChat({ slug, chatId: null, message: 'hi', priorMessages: [] });

    await vi.waitFor(() => expect(getAgentUseChatSnapshot(slug).running).toBe(false));
    unsub();

    expect(seen).toContain('query_sql:running');
    expect(seen).toContain('query_sql:success');
    const done = getAgentUseChatSnapshot(slug);
    expect(done.toolCalls).toEqual([]);
    expect(done.startedAt).toBeNull();
    expect(done.messages.at(-1)?.content).toBe('Done.');
  });

  it('keeps an inspection note on the reply after the stream ends', async () => {
    vi.stubGlobal(
      'fetch',
      streamOf([
        { type: 'text', delta: 'Dinesh S is active.' },
        { type: 'inspection', inspection: { sources: 'a.b.c', joins: 'assumed', caveats: 'one gap' } },
      ]),
    );
    startAgentUseChat({ slug, chatId: null, message: 'hi', priorMessages: [] });
    await vi.waitFor(() => expect(getAgentUseChatSnapshot(slug).running).toBe(false));
    expect(getAgentUseChatSnapshot(slug).messages.at(-1)).toMatchObject({
      content: 'Dinesh S is active.',
      inspection: { sources: 'a.b.c', joins: 'assumed', caveats: 'one gap' },
    });
  });

  it('keeps the turn running when the connection drops, then shows the saved reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/chats/')) {
        return {
          ok: true,
          json: async () => ({
            chat: {
              messages: [
                { id: 'u', role: 'user', content: 'hello' },
                { id: 'a', role: 'assistant', content: 'finished away' },
              ],
              draft: { status: 'done', text: 'finished away' },
            },
          }),
        };
      }
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }));

    startAgentUseChat({ slug, chatId: CHAT_ID, message: 'hello', priorMessages: [] });
    expect(getAgentUseChatSnapshot(slug).running).toBe(true);
    await vi.waitFor(() => expect(getAgentUseChatSnapshot(slug).running).toBe(false), { timeout: 4000 });
    expect(getAgentUseChatSnapshot(slug).messages.at(-1)?.content).toBe('finished away');
  });

  it('Send now: stops the running reply on the server by turn id and keeps its partial text, marked stopped', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let first = true;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      if (url.endsWith('/cancel')) return { ok: true, json: async () => ({ ok: true }) };
      if (first) {
        first = false;
        // First reply: one chunk, then hangs until aborted.
        const chunks = [
          new TextEncoder().encode(`data: ${JSON.stringify({ type: 'chat', chatId: CHAT_ID })}\n\n`),
          new TextEncoder().encode(`data: ${JSON.stringify({ type: 'text', delta: 'partial' })}\n\n`),
        ];
        return {
          ok: true,
          body: {
            getReader: () => ({
              read: () => {
                const value = chunks.shift();
                if (value) return Promise.resolve({ done: false, value });
                return new Promise((_resolve, reject) => {
                  init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                });
              },
            }),
          },
        };
      }
      return streamOf([{ type: 'text', delta: 'second answer' }, { type: 'done' }])(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    startAgentUseChat({ slug, chatId: null, message: 'first', priorMessages: [] });
    await vi.waitFor(() => expect(getAgentUseChatSnapshot(slug).messages.at(-1)?.content).toBe('partial'));
    const firstTurnId = calls[0].body.turnId;

    startAgentUseChat({ slug, chatId: CHAT_ID, message: 'second', priorMessages: [] });
    await vi.waitFor(() => expect(getAgentUseChatSnapshot(slug).running).toBe(false));

    const cancel = calls.find((c) => c.url.endsWith('/cancel'));
    expect(cancel?.body).toEqual({ chatId: CHAT_ID, turnId: firstTurnId });
    const second = calls.filter((c) => c.url.endsWith('/agents/chat'))[1];
    expect(second.body.turnId).not.toBe(firstTurnId);

    const messages = getAgentUseChatSnapshot(slug).messages;
    expect(messages.map((m) => `${m.role}:${m.content}${m.stopped ? ' (stopped)' : ''}`)).toEqual([
      'user:first',
      'assistant:partial (stopped)',
      'user:second',
      'assistant:second answer',
    ]);
  });
});
