import { NextRequest, NextResponse } from 'next/server';
import { authenticateSession } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { canViewAgentChatOwnedBy, getAgentChat } from '@/lib/agents/agent-chats';
import { messagesForViewer } from '@/lib/agents/inspection';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One saved agent chat. The owner gets it to continue; platform admins (session:read:all) get it
 * read-only for audit — except another platform admin's chat, which only its owner can see.
 * Anyone else gets 404 so chat ids do not leak.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSession();
  if (!auth) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });

  try {
    const chat = await getAgentChat(id);
    const isOwner = !!chat && chat.user_id === auth.userId;
    const allowed =
      !!chat &&
      (isOwner ||
        (auth.permissions.has(PERMISSIONS.SESSION_READ_ALL) && (await canViewAgentChatOwnedBy(auth.userId, chat.user_id))));
    if (!chat || !allowed) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    return NextResponse.json({
      chat: {
        id: chat.id,
        title: chat.title,
        agentId: chat.agentId,
        slug: chat.slug,
        messages: messagesForViewer(chat.messages, auth.role),
        readOnly: !isOwner,
        updatedAt: chat.updated_at?.toISOString() ?? null,
      },
    });
  } catch (err) {
    console.error('[agents/chats/:id GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
