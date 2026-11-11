import { NextRequest, NextResponse } from 'next/server';
import { requestTurnStop, turnStopKey } from '@/lib/chat/turn-control';
import { guardSessionRead } from '@/lib/inspector/session-auth';

export const dynamic = 'force-dynamic';

/** Stop button. Leaving the page does not call this, so the reply keeps generating. */
export async function POST(request: NextRequest) {
  let sessionId = '';
  try {
    const body = (await request.json()) as { sessionId?: unknown };
    sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  } catch {
    return NextResponse.json({ error: 'Session id required' }, { status: 400 });
  }
  if (!sessionId) return NextResponse.json({ error: 'Session id required' }, { status: 400 });

  const blocked = await guardSessionRead(request, sessionId, { route: '/api/inspector/chat/cancel' });
  if (blocked) return blocked;

  requestTurnStop(turnStopKey('inspector', sessionId));
  return NextResponse.json({ ok: true });
}
