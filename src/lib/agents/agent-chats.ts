/**
 * Saved conversations with a commissioned agent (Agents → Use). One row per conversation in
 * `workbench_sessions` with `surface = 'agent_use'` and the agent in `progress.agentUse`.
 * `saved_agent_id` stays empty on purpose: on a Workbench row it means "this session builds that
 * agent", and the Workbench chat writes the draft back to it.
 *
 * Each chat belongs to the person who started it. Only the owner can read it here or send to it;
 * platform admins can open other people's chats read-only from the agent page's separate "Review" list,
 * except other platform admins' chats, which only their owner ever sees. Agent chats are not listed in
 * Chat History, so other people's chats never sit next to your own.
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { agentUseLink } from '@/lib/sessions/surfaces';
import { parseInspection, type AgentInspection } from '@/lib/agents/inspection';
import { readTurnDraft, type TurnDraft } from '@/lib/chat/turn-draft';

export const AGENT_CHAT_SURFACE = 'agent_use';

export type AgentChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  /** Tables, join, and caveats. Present only on assistant messages, and only returned to an admin. */
  inspection?: AgentInspection;
};
export type AgentTurn = { role: 'user' | 'assistant'; content: string };

/** How much of the saved chat is sent to the model each turn (the chat itself is kept in full). */
export const MODEL_HISTORY_MAX_MESSAGES = 30;
export const MODEL_HISTORY_MAX_CHARS = 60_000;

export type AgentChatRow = {
  id: string;
  user_id: string | null;
  title: string | null;
  messages: AgentChatMessage[];
  agentId: string | null;
  slug: string | null;
  /** Set while a reply is still generating after the browser dropped the stream. */
  draft: TurnDraft | null;
  updated_at: Date | null;
  created_at: Date | null;
};

export function parseChatMessages(raw: unknown): AgentChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { id, role, content, timestamp, inspection } = item as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return [];
    const note = parseInspection(inspection);
    return [{
      id: typeof id === 'string' ? id : randomUUID(),
      role,
      content,
      ...(typeof timestamp === 'number' ? { timestamp } : {}),
      ...(note ? { inspection: note } : {}),
    }];
  });
}

/**
 * The tail of a saved chat, shaped for the model: alternating roles, starting with the user,
 * within the message and character budgets. Consecutive same-role messages (a reply that never
 * arrived) are merged.
 */
export function historyForModel(messages: AgentChatMessage[]): AgentTurn[] {
  const turns: AgentTurn[] = [];
  for (const m of messages) {
    const text = m.content.trim();
    if (!text) continue;
    const previous = turns[turns.length - 1];
    if (previous?.role === m.role) previous.content = `${previous.content}\n\n${text}`;
    else turns.push({ role: m.role, content: text });
  }
  let start = Math.max(0, turns.length - MODEL_HISTORY_MAX_MESSAGES);
  let chars = turns.slice(start).reduce((n, t) => n + t.content.length, 0);
  while (start < turns.length && chars > MODEL_HISTORY_MAX_CHARS) {
    chars -= turns[start].content.length;
    start++;
  }
  while (start < turns.length && turns[start].role !== 'user') start++;
  return turns.slice(start);
}

function toRow(row: {
  id: string;
  user_id: string | null;
  title: string | null;
  messages: unknown;
  progress: unknown;
  updated_at: Date | null;
  created_at: Date | null;
}): AgentChatRow {
  const link = agentUseLink(row.progress);
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    messages: parseChatMessages(row.messages),
    agentId: link?.agentId ?? null,
    slug: link?.slug ?? null,
    draft: readTurnDraft(row.progress, 'agentDraft'),
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

const chatSelect = { id: true, user_id: true, title: true, messages: true, progress: true, updated_at: true, created_at: true } as const;

export async function getAgentChat(chatId: string): Promise<AgentChatRow | null> {
  const row = await prisma.workbench_sessions.findFirst({ where: { id: chatId, surface: AGENT_CHAT_SURFACE }, select: chatSelect });
  return row ? toRow(row) : null;
}

export async function createAgentChat(input: { userId: string; agent: { id: string; slug: string }; firstMessage: string }): Promise<AgentChatRow> {
  const row = await prisma.workbench_sessions.create({
    data: {
      user_id: input.userId,
      surface: AGENT_CHAT_SURFACE,
      artifact_type: 'agent',
      title: input.firstMessage.trim().slice(0, 80) || null,
      messages: [],
      message_count: 0,
      progress: { agentUse: { agentId: input.agent.id, slug: input.agent.slug } },
    },
    select: chatSelect,
  });
  return toRow(row);
}

/** The person's own chats with one agent, newest first. Never other people's, admins included. */
export async function listOwnAgentChats(userId: string, agentId: string, take = 50) {
  return prisma.workbench_sessions.findMany({
    where: {
      user_id: userId,
      surface: AGENT_CHAT_SURFACE,
      progress: { path: ['agentUse', 'agentId'], equals: agentId },
    },
    orderBy: [{ pinned: 'desc' }, { updated_at: 'desc' }],
    take,
    select: { id: true, title: true, last_message: true, message_count: true, pinned: true, updated_at: true, created_at: true },
  });
}

export const PLATFORM_ADMIN_ROLE = 'platform_admin';

export async function isPlatformAdminUser(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const n = await prisma.user.count({ where: { id: userId, roles: { some: { role: { name: PLATFORM_ADMIN_ROLE } } } } });
  return n > 0;
}

async function platformAdminUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { roles: { some: { role: { name: PLATFORM_ADMIN_ROLE } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Whether `viewerId` may see an agent chat owned by `ownerId` through an admin "read all" path.
 * Platform admins' chats are only ever visible to their owner; callers still check `session:read:all`.
 */
export async function canViewAgentChatOwnedBy(viewerId: string, ownerId: string | null): Promise<boolean> {
  if (ownerId === viewerId) return true;
  return !(await isPlatformAdminUser(ownerId));
}

/**
 * `workbench_sessions` filter for admin "all users" lists: drops agent chats owned by other platform
 * admins. Spread into a `where` (uses `AND`). Written with OR (not NOT) so rows with a null surface or
 * owner are kept.
 */
export async function hideOtherAdminsAgentChatsWhere(viewerId: string) {
  const otherAdmins = (await platformAdminUserIds()).filter((id) => id !== viewerId);
  if (otherAdmins.length === 0) return {};
  return {
    AND: [
      {
        OR: [
          { surface: null },
          { surface: { not: AGENT_CHAT_SURFACE } },
          { user_id: null },
          { user_id: { notIn: otherAdmins } },
        ],
      },
    ],
  };
}

/**
 * Review: other people's chats with one agent (never the caller's own — those are in "Your chats"),
 * newest first, with the owner's name. Platform admins' chats are left out, so admins never see each
 * other's. Callers must check `session:read:all` first.
 */
export async function listAgentChatsForReview(agentId: string, excludeUserId: string, take = 100) {
  const adminIds = await platformAdminUserIds();
  const rows = await prisma.workbench_sessions.findMany({
    where: {
      surface: AGENT_CHAT_SURFACE,
      OR: [{ user_id: null }, { user_id: { notIn: [...new Set([...adminIds, excludeUserId])] } }],
      progress: { path: ['agentUse', 'agentId'], equals: agentId },
    },
    orderBy: { updated_at: 'desc' },
    take,
    select: { id: true, user_id: true, title: true, last_message: true, message_count: true, updated_at: true, created_at: true },
  });
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const u = r.user_id ? byId.get(r.user_id) : undefined;
    return { ...r, owner: u ? u.name || u.email || 'Unknown user' : 'Unknown user' };
  });
}

/**
 * Append messages in one statement, so two tabs on the same chat cannot overwrite each other's
 * turns. Also keeps the list preview fields (count, last user message) current.
 */
export async function appendAgentChatMessages(chatId: string, add: AgentChatMessage[]): Promise<void> {
  const kept = add.filter((m) => m.content.trim());
  if (kept.length === 0) return;
  const lastUser = [...kept].reverse().find((m) => m.role === 'user')?.content.slice(0, 120) ?? null;
  await prisma.$executeRaw`
    UPDATE workbench_sessions
    SET messages = COALESCE(messages, '[]'::jsonb) || ${JSON.stringify(kept)}::jsonb,
        message_count = jsonb_array_length(COALESCE(messages, '[]'::jsonb)) + ${kept.length},
        last_message = COALESCE(${lastUser}, last_message),
        updated_at = now()
    WHERE id = ${chatId}::uuid AND surface = ${AGENT_CHAT_SURFACE}
  `;
}

export function newChatMessage(role: 'user' | 'assistant', content: string, inspection?: AgentInspection | null): AgentChatMessage {
  return { id: randomUUID(), role, content, timestamp: Date.now(), ...(inspection ? { inspection } : {}) };
}
