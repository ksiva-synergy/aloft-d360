/**
 * Agent chat: HTTP errors come back before the stream starts, the stream carries the runner's
 * events, and signed-in people get a saved, private chat (history read from the server, turn saved
 * at the end). The runner and the chat store are fakes here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  runCatalogAgent: vi.fn(),
  principal: vi.fn(),
  getAgentChat: vi.fn(),
  createAgentChat: vi.fn(),
  appendAgentChatMessages: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { agent_catalog: { findFirst: h.findFirst } } }));
vi.mock('@/lib/inspector/session-auth', () => ({ guardInspectorChat: async () => null, resolveInspectorPrincipal: h.principal }));
vi.mock('@/lib/inspector/llm-configured', () => ({ inspectorLlmConfigured: () => true }));
vi.mock('@/lib/construction/catalog-sync', () => ({ runtimeBriefFromCatalog: (a: { config?: { noBrief?: boolean } }) => (a.config?.noBrief ? null : { name: 'x' }) }));
vi.mock('@/lib/construction/workbench-model', () => ({ resolveWorkbenchModel: () => ({ effectiveModelId: 'm-1' }) }));
vi.mock('@/lib/inspector/session-role', () => ({ getSessionUserRole: async () => 'member' }));
vi.mock('@/lib/agents/run-catalog-agent', () => ({ runCatalogAgent: h.runCatalogAgent }));
vi.mock('@/lib/agents/agent-chats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/agent-chats')>();
  return {
    ...actual,
    getAgentChat: h.getAgentChat,
    createAgentChat: h.createAgentChat,
    appendAgentChatMessages: h.appendAgentChatMessages,
  };
});

import { POST } from '../chat/route';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';

const post = (body: unknown) =>
  POST(new Request('http://test/api/agent-lab/agents/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);

async function events(res: Response) {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
}

function replyWith(text: string) {
  h.runCatalogAgent.mockImplementation(async (input: { onTextChunk: (d: string) => void; onToolEvent: (e: object) => void }) => {
    input.onToolEvent({ type: 'query_result', rows: [] });
    input.onTextChunk(text);
    return { outcome: 'completed', loops: 2, usage: { inputTokens: 10, outputTokens: 2 }, model: 'm-1' };
  });
}

beforeEach(() => {
  h.findFirst.mockReset().mockResolvedValue({ id: 'cat-1', slug: 'tracer', name: 'Regulatory Decision Tracer', config: {} });
  h.runCatalogAgent.mockReset();
  h.principal.mockReset().mockResolvedValue({ kind: 'user', userId: 'u-1' });
  h.getAgentChat.mockReset();
  h.createAgentChat.mockReset().mockResolvedValue({ id: CHAT_ID, user_id: 'u-1', messages: [], agentId: 'cat-1', slug: 'tracer' });
  h.appendAgentChatMessages.mockReset().mockResolvedValue(undefined);
});

describe('agent chat', () => {
  it('keeps its HTTP errors for a missing agent or one without instructions', async () => {
    h.findFirst.mockResolvedValueOnce(null);
    expect((await post({ slug: 'nope', message: 'hi' })).status).toBe(404);
    h.findFirst.mockResolvedValueOnce({ id: 'c', name: 'n', config: { noBrief: true } });
    expect((await post({ slug: 's', message: 'hi' })).status).toBe(400);
    expect(h.runCatalogAgent).not.toHaveBeenCalled();
  });

  it('starts a saved chat for a signed-in person and saves the turn when done', async () => {
    replyWith('Hello');
    const res = await post({ slug: 'tracer', message: 'hi', history: [{ role: 'user', content: 'ignored' }] });
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual(['stream_start', 'chat', 'query_result', 'text', 'done']);
    expect(evs[1]).toEqual({ type: 'chat', chatId: CHAT_ID });
    expect(evs.at(-1)).toEqual({ type: 'done', outcome: 'completed', loops: 2, usage: { inputTokens: 10, outputTokens: 2 }, model: 'm-1' });

    expect(h.createAgentChat).toHaveBeenCalledWith({ userId: 'u-1', agent: { id: 'cat-1', slug: 'tracer' }, firstMessage: 'hi' });
    // Request history is ignored for people; the saved chat is the source of truth.
    expect(h.runCatalogAgent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'tracer', message: 'hi', history: [], surface: 'agent_use', sessionId: CHAT_ID, person: { userId: 'u-1', role: 'member' } }),
    );
    const [savedId, saved] = h.appendAgentChatMessages.mock.calls[0];
    expect(savedId).toBe(CHAT_ID);
    expect(saved.map((m: { role: string; content: string }) => `${m.role}:${m.content}`)).toEqual(['user:hi', 'assistant:Hello']);
  });

  it('continues an own chat with history loaded from the server', async () => {
    replyWith('Sure');
    h.getAgentChat.mockResolvedValue({
      id: CHAT_ID,
      user_id: 'u-1',
      agentId: 'cat-1',
      slug: 'tracer',
      messages: [
        { id: '1', role: 'user', content: 'earlier' },
        { id: '2', role: 'assistant', content: 'ok' },
      ],
    });
    const evs = await events(await post({ slug: 'tracer', message: 'more', chatId: CHAT_ID }));
    expect(evs[1]).toEqual({ type: 'chat', chatId: CHAT_ID });
    expect(h.createAgentChat).not.toHaveBeenCalled();
    expect(h.runCatalogAgent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'more', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }], sessionId: CHAT_ID }),
    );
  });

  it("refuses to write into someone else's chat or a chat with another agent", async () => {
    h.getAgentChat.mockResolvedValueOnce({ id: CHAT_ID, user_id: 'u-2', agentId: 'cat-1', messages: [] });
    expect((await post({ slug: 'tracer', message: 'hi', chatId: CHAT_ID })).status).toBe(403);
    h.getAgentChat.mockResolvedValueOnce({ id: CHAT_ID, user_id: 'u-1', agentId: 'cat-9', messages: [] });
    expect((await post({ slug: 'tracer', message: 'hi', chatId: CHAT_ID })).status).toBe(400);
    h.getAgentChat.mockResolvedValueOnce(null);
    expect((await post({ slug: 'tracer', message: 'hi', chatId: CHAT_ID })).status).toBe(404);
    expect((await post({ slug: 'tracer', message: 'hi', chatId: 'not-a-uuid' })).status).toBe(400);
    expect(h.runCatalogAgent).not.toHaveBeenCalled();
    expect(h.appendAgentChatMessages).not.toHaveBeenCalled();
  });

  it('saves the turn even when the run fails', async () => {
    h.runCatalogAgent.mockImplementation(async (input: { onTextChunk: (d: string) => void }) => {
      input.onTextChunk('Partial');
      throw new Error('boom');
    });
    const evs = await events(await post({ slug: 'tracer', message: 'hi' }));
    expect(evs.map((e) => e.type)).toEqual(['stream_start', 'chat', 'text', 'error', 'done']);
    const saved = h.appendAgentChatMessages.mock.calls[0][1];
    expect(saved.map((m: { content: string }) => m.content)).toEqual(['hi', 'Partial']);
  });

  it('stays stateless for service callers (request history, nothing saved)', async () => {
    h.principal.mockResolvedValue({ kind: 'service' });
    replyWith('Hello');
    const evs = await events(await post({ slug: 'tracer', message: 'hi', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }] }));
    expect(evs.map((e) => e.type)).toEqual(['stream_start', 'query_result', 'text', 'done']);
    expect(h.runCatalogAgent).toHaveBeenCalledWith(
      expect.objectContaining({ person: null, history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }] }),
    );
    expect(h.createAgentChat).not.toHaveBeenCalled();
    expect(h.appendAgentChatMessages).not.toHaveBeenCalled();
    expect((await post({ slug: 'tracer', message: 'hi', chatId: CHAT_ID })).status).toBe(401);
  });
});
