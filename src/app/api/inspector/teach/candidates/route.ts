/**
 * src/app/api/inspector/teach/candidates/route.ts
 *
 * Teach Phase 3 — the READ-ONLY candidate feed endpoint (the hand-off boundary).
 *
 * GET returns the caller's own ACTIVE personal candidates as TeachCandidate[]
 * (plus the ready-to-hand-off count). Strictly read-only: it projects what
 * capture persisted; it does NOT capture, verify, resolve, promote, or credit.
 *
 * AUTH: fail-closed. No resolved user → 401 (can't be hit unauthenticated). When
 * scoped to a session, it also runs the loop's session-ownership guard
 * (guardInspectorChat), matching /api/inspector/teach's posture. Candidate
 * scoping itself is by author (created_by) inside getTeachFeed — a caller can
 * only ever see their own candidates.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { getTeachFeed } from '@/lib/inspector/teach-feed';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionId = new URL(request.url).searchParams.get('sessionId') || null;

    // Preserve the loop's session-ownership posture when scoping to a session.
    const authBlock = await guardInspectorChat(request, sessionId ?? undefined);
    if (authBlock) return authBlock;

    const org = await getDefaultOrg();
    const feed = await getTeachFeed(org.id, currentUser.id, { sessionId });
    return NextResponse.json(feed);
  } catch (err) {
    console.error('[teach/candidates GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
