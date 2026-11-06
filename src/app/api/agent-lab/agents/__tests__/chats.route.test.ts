/**
 * Saved agent chats are private: owner reads to continue, admins read-only, everyone else 404.
 * Platform admins' chats are only ever visible to their owner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getAgentChat: vi.fn(),
  findFirst: vi.fn(),
  listOwn: vi.fn(),
  listReview: vi.fn(),
  admins: new Set<string>(),
}));

vi.mock('@/middleware/auth', () => ({ authenticateSession: h.auth }));
vi.mock('@/lib/db', () => ({ prisma: { agent_catalog: { findFirst: h.findFirst } } }));
vi.mock('@/lib/agents/agent-chats', () => ({
  getAgentChat: h.getAgentChat,
  listOwnAgentChats: h.listOwn,
  listAgentChatsForReview: h.listReview,
  canViewAgentChatOwnedBy: async (viewer: string, owner: string | null) => owner === viewer || !owner || !h.admins.has(owner),
}));

import { PERMISSIONS } from '@/lib/rbac';
import { GET as getOne } from '../chats/[id]/route';
import { GET as list } from '../chats/route';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const chat = { id: CHAT_ID, user_id: 'owner', title: 't', agentId: 'a1', slug: 'tracer', messages: [], updated_at: null };
const as = (userId: string, perms: string[] = [], role = 'member') => h.auth.mockResolvedValue({ userId, role, permissions: new Set(perms) });
const read = (id = CHAT_ID) => getOne(new Request(`http://test/api/agent-lab/agents/chats/${id}`) as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
  h.auth.mockReset();
  h.getAgentChat.mockReset().mockResolvedValue(chat);
  h.findFirst.mockReset().mockResolvedValue({ id: 'a1' });
  h.listOwn.mockReset().mockResolvedValue([]);
  h.listReview.mockReset().mockResolvedValue([]);
  h.admins.clear();
});

describe('GET /api/agent-lab/agents/chats/:id', () => {
  it('lets the owner continue their chat', async () => {
    as('owner');
    const res = await read();
    expect(res.status).toBe(200);
    expect((await res.json()).chat).toMatchObject({ id: CHAT_ID, readOnly: false });
  });

  it('gives platform admins read-only access', async () => {
    as('admin', [PERMISSIONS.SESSION_READ_ALL]);
    expect((await (await read()).json()).chat).toMatchObject({ readOnly: true });
  });

  it("never shows another platform admin's chat to other platform admins", async () => {
    h.admins.add('owner').add('admin');
    as('admin', [PERMISSIONS.SESSION_READ_ALL]);
    expect((await read()).status).toBe(404);
  });

  it('returns the inspection note to an admin and omits it for a member', async () => {
    const note = { sources: 'a.b.employee', joins: 'assumed on employee id', caveats: 'One date is missing.' };
    h.getAgentChat.mockResolvedValue({
      ...chat,
      messages: [{ id: 'm1', role: 'assistant', content: 'Dinesh S is active.', inspection: note }],
    });
    as('owner', [], 'admin');
    expect((await (await read()).json()).chat.messages[0].inspection).toEqual(note);
    as('owner');
    expect((await (await read()).json()).chat.messages[0].inspection).toBeUndefined();
    as('reviewer', [PERMISSIONS.SESSION_READ_ALL], 'platform_admin');
    expect((await (await read()).json()).chat.messages[0].inspection).toEqual(note);
  });

  it("hides other people's chats from everyone else", async () => {
    as('someone-else');
    expect((await read()).status).toBe(404);
    expect((await read('not-a-uuid')).status).toBe(404);
    h.auth.mockResolvedValue(null);
    expect((await read()).status).toBe(401);
  });
});

describe('GET /api/agent-lab/agents/chats', () => {
  const get = (qs: string) => list(new NextRequest(`http://test/api/agent-lab/agents/chats?${qs}`));

  it("lists only the caller's own chats with the agent, even for admins", async () => {
    as('admin', [PERMISSIONS.SESSION_READ_ALL]);
    const res = await get('slug=tracer');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scope: 'mine', canReview: true });
    expect(h.listOwn).toHaveBeenCalledWith('admin', 'a1');
    expect(h.listReview).not.toHaveBeenCalled();
  });

  it('keeps other people’s chats in a separate admin-only review list', async () => {
    as('member');
    expect(await (await get('slug=tracer')).json()).toMatchObject({ canReview: false });
    expect((await get('slug=tracer&scope=review')).status).toBe(403);
    expect(h.listReview).not.toHaveBeenCalled();

    as('admin', [PERMISSIONS.SESSION_READ_ALL]);
    h.listReview.mockResolvedValue([{ id: CHAT_ID, title: 't', last_message: null, message_count: 2, owner: 'Ana', updated_at: null, created_at: null }]);
    const body = await (await get('slug=tracer&scope=review')).json();
    expect(h.listReview).toHaveBeenCalledWith('a1', 'admin');
    expect(body).toMatchObject({ scope: 'review', chats: [{ id: CHAT_ID, owner: 'Ana' }] });
  });
});
