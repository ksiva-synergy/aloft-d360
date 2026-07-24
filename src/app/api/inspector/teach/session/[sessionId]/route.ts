/**
 * src/app/api/inspector/teach/session/[sessionId]/route.ts
 *
 * Teach retention (session-draft-retention plan, Track A) — the guarded HYDRATE
 * endpoint. One call returns everything a reload needs to restore a Teach session:
 *   { session: { id, title, surface, messages }, feed }
 *   - session.messages → replayed into the thread
 *   - feed.candidates   → projected back into the "What Marcus is learning" rail
 *
 * THREE deviations from Inspector's defaults are honored here (plan §2.1):
 *
 *  1. ENFORCE-MODE AUTH ON READS. Unlike guardInspectorChat (observe-mode by
 *     default), this uses guardSessionRead, which ALWAYS enforces ownership.
 *     Loading someone else's teaching session 403s — it never serves. The shared
 *     workbench GET has no ownership check, so hydrate goes through this route,
 *     not that one.
 *
 *  2. EXPLICIT ORG. The rail feed is scoped by (org_id, author, session_id). The
 *     candidate rows were written with org = getDefaultOrg() (teach/route.ts), and
 *     this read resolves org the SAME way — so the two never drift and the rail
 *     query can't silently return empty on an org mismatch. We do NOT read an org
 *     off the session row (it has no org column).
 *
 * The transient 'verifying' state is deliberately NOT reconstructed: the feed only
 * ever yields persisted states (proposed | verified | conflict | resolved), so a
 * card that was mid-verification when the tab closed comes back at its LAST STORED
 * verification outcome — we never auto re-fire a verify query on hydrate (A3).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { guardSessionRead } from '@/lib/inspector/session-auth';
import { getTeachFeed } from '@/lib/inspector/teach-feed';
import type { WorkbenchMessage } from '@/components/agent-lab/workbench/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;

    // Deviation #1 — always-enforce ownership on the READ.
    const authBlock = await guardSessionRead(request, sessionId, {
      route: '/api/inspector/teach/session',
    });
    if (authBlock) return authBlock;

    const row = await prisma.workbench_sessions.findUnique({
      where: { id: sessionId },
      select: { id: true, title: true, surface: true, messages: true },
    });
    // Teach-only route: a non-teach (or missing) session is a 404 here — hydrate
    // never crosses surfaces.
    if (!row || row.surface !== 'teach') {
      return NextResponse.json({ error: 'Teach session not found' }, { status: 404 });
    }

    // Deviation #2 — resolve org the SAME way the write path did (getDefaultOrg),
    // so the rail's (org_id, author, session_id) scope matches the candidate rows.
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;
    const org = await getDefaultOrg();
    const feed = await getTeachFeed(org.id, currentUser?.id ?? null, { sessionId });

    return NextResponse.json({
      session: {
        id: row.id,
        title: row.title,
        surface: row.surface,
        messages: (row.messages as WorkbenchMessage[] | null) ?? [],
      },
      feed,
    });
  } catch (err) {
    console.error('[teach/session/:id GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
