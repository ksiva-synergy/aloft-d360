import { NextRequest, NextResponse } from 'next/server';
import { getPendingReflections } from '@/lib/marcus/dal';
import { guardSessionRead } from '@/lib/inspector/session-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  if (process.env.MARCUS_REFLECT_ENABLED !== 'true') {
    return NextResponse.json({ pendingReflections: [] });
  }

  const denied = await guardSessionRead(request, sessionId, { route: 'marcus/reflections' });
  if (denied) return denied;

  try {
    const pending = await getPendingReflections(sessionId);
    const pendingReflections = pending.map(r => ({
      id: r.id,
      triggerType: r.triggerType,
      technique: r.technique,
      headline: r.headline,
      body: r.body,
      severity: r.severity,
      suggestedAction: r.suggestedAction,
      status: r.status,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      turnIndex: r.turnIndex,
    }));
    return NextResponse.json({ pendingReflections });
  } catch (err) {
    console.error('[marcus/reflections GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
