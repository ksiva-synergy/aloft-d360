import { NextRequest, NextResponse } from 'next/server';
import { getAgentChat } from '@/lib/agents/agent-chats';
import { requestTurnStop, turnStopKey } from '@/lib/chat/turn-control';
import { authenticateSession } from '@/middleware/auth';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stop button for a saved-agent chat. Tab switches do not call this. */
export async function POST(request: NextRequest) {
  const auth = await authenticateSession();
  if (!auth) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  let chatId = '';
  try {
    const body = (await request.json()) as { chatId?: unknown };
    chatId = typeof body.chatId === 'string' ? body.chatId : '';
  } catch {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }
  if (!UUID_RE.test(chatId)) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });

  const chat = await getAgentChat(chatId);
  if (!chat || chat.user_id !== auth.userId) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }

  requestTurnStop(turnStopKey('agent', chatId));
  return NextResponse.json({ ok: true });
}
