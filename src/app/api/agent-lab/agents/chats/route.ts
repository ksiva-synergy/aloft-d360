import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authenticateSession } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { listAgentChatsForReview, listOwnAgentChats } from '@/lib/agents/agent-chats';

export const dynamic = 'force-dynamic';

/**
 * Chats with one agent (`?slug=`).
 * - default: the signed-in person's own chats. Never anyone else's, admins included.
 * - `scope=review`: other people's chats, read-only audit for `session:read:all`, excluding platform
 *   admins' chats (admins never see each other's). Kept as a separate list so other people's chats
 *   never appear next to your own.
 * `canReview` tells the page whether to offer the review list.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateSession();
  if (!auth) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const slug = request.nextUrl.searchParams.get('slug')?.trim();
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  const canReview = auth.permissions.has(PERMISSIONS.SESSION_READ_ALL);
  const review = request.nextUrl.searchParams.get('scope') === 'review';
  if (review && !canReview) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const agent = await prisma.agent_catalog.findFirst({ where: { slug }, select: { id: true } });
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    if (review) {
      const rows = await listAgentChatsForReview(agent.id, auth.userId);
      return NextResponse.json({
        canReview,
        scope: 'review',
        chats: rows.map((r) => ({
          id: r.id,
          title: r.title,
          lastMessage: r.last_message,
          messageCount: r.message_count ?? 0,
          pinned: false,
          owner: r.owner,
          updatedAt: r.updated_at?.toISOString() ?? null,
          createdAt: r.created_at?.toISOString() ?? null,
        })),
      });
    }
    const rows = await listOwnAgentChats(auth.userId, agent.id);
    return NextResponse.json({
      canReview,
      scope: 'mine',
      chats: rows.map((r) => ({
        id: r.id,
        title: r.title,
        lastMessage: r.last_message,
        messageCount: r.message_count ?? 0,
        pinned: r.pinned ?? false,
        updatedAt: r.updated_at?.toISOString() ?? null,
        createdAt: r.created_at?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error('[agents/chats GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
