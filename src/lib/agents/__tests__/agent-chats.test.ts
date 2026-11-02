import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn(), count: vi.fn() },
  workbench_sessions: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  canViewAgentChatOwnedBy,
  hideOtherAdminsAgentChatsWhere,
  historyForModel,
  listAgentChatsForReview,
  MODEL_HISTORY_MAX_MESSAGES,
  parseChatMessages,
  type AgentChatMessage,
} from '@/lib/agents/agent-chats';

describe('platform admin chat privacy', () => {
  beforeEach(() => {
    db.user.findMany.mockReset().mockResolvedValue([{ id: 'me' }, { id: 'other' }]);
    db.user.count.mockReset().mockImplementation(async ({ where }: { where: { id: string } }) => (['me', 'other'].includes(where.id) ? 1 : 0));
    db.workbench_sessions.findMany.mockReset().mockResolvedValue([]);
  });

  it("never shows another platform admin's chat; members' chats and your own stay visible", async () => {
    expect(await canViewAgentChatOwnedBy('me', 'me')).toBe(true);
    expect(await canViewAgentChatOwnedBy('me', 'member-1')).toBe(true);
    expect(await canViewAgentChatOwnedBy('me', 'other')).toBe(false);
  });

  it('filters other admins’ agent chats out of "all users" lists, keeping null surface/owner rows', async () => {
    expect(await hideOtherAdminsAgentChatsWhere('me')).toEqual({
      AND: [{ OR: [{ surface: null }, { surface: { not: 'agent_use' } }, { user_id: null }, { user_id: { notIn: ['other'] } }] }],
    });
  });

  it('leaves platform admins’ chats (and your own) out of the review list', async () => {
    await listAgentChatsForReview('a1', 'me');
    expect(db.workbench_sessions.findMany.mock.calls[0][0].where).toMatchObject({
      OR: [{ user_id: null }, { user_id: { notIn: ['me', 'other'] } }],
    });
  });
});

const msg = (role: 'user' | 'assistant', content: string): AgentChatMessage => ({ id: content, role, content });

describe('historyForModel', () => {
  it('merges same-role runs and drops empty messages', () => {
    expect(historyForModel([msg('user', 'a'), msg('assistant', ' '), msg('user', 'b'), msg('assistant', 'c')])).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
    ]);
  });

  it('keeps only the most recent turns and starts on a user message', () => {
    const long: AgentChatMessage[] = [];
    for (let i = 0; i < 50; i++) long.push(msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const out = historyForModel(long);
    expect(out.length).toBeLessThanOrEqual(MODEL_HISTORY_MAX_MESSAGES);
    expect(out[0].role).toBe('user');
    expect(out.at(-1)?.content).toBe('m49');
  });

  it('drops the oldest turns past the character budget', () => {
    const big = 'x'.repeat(40_000);
    const out = historyForModel([msg('user', big), msg('assistant', big), msg('user', 'q'), msg('assistant', 'a')]);
    expect(out).toEqual([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]);
  });
});

describe('parseChatMessages', () => {
  it('keeps only well-formed user/assistant messages', () => {
    expect(parseChatMessages([{ id: '1', role: 'user', content: 'hi' }, { role: 'system', content: 'x' }, null, 'bad'])).toEqual([
      { id: '1', role: 'user', content: 'hi' },
    ]);
    expect(parseChatMessages(null)).toEqual([]);
  });

  it('keeps an inspection note on the assistant message and leaves it out of the model history', () => {
    const parsed = parseChatMessages([
      { id: 'u', role: 'user', content: 'Who is Dinesh?' },
      { id: '1', role: 'assistant', content: 'Plain answer.', inspection: { sources: 'a.b.c', joins: 'assumed', caveats: '', extra: true } },
    ]);
    expect(parsed[1]).toEqual({ id: '1', role: 'assistant', content: 'Plain answer.', inspection: { sources: 'a.b.c', joins: 'assumed', caveats: '' } });
    expect(historyForModel(parsed)).toEqual([
      { role: 'user', content: 'Who is Dinesh?' },
      { role: 'assistant', content: 'Plain answer.' },
    ]);
  });
});
