import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export interface KeptBullet {
  id: string;
  ruleText: string;
  ruleType: string;
  confidence: number;
  rationale: string | null;
  agentClass: string | null;
  createdAt: string;
}

export interface KeeperSummaryResponse {
  /** Number of nightly runs included in the window */
  runsCount: number;
  /** Total sessions scanned across all runs */
  sessionsScanned: number;
  /** Total candidates produced (memories analyzed) across all runs */
  memoriesAnalyzed: number;
  /** Total bullets kept (inserted + deduped) across all runs */
  memoriesKept: number;
  /** Total phantoms blocked across all runs */
  phantomsBlocked: number;
  /** Total discarded across all runs */
  discarded: number;
  /** Window in days used */
  windowDays: number;
  /** All active bullets sourced from sessions within the window, deduplicated */
  bullets: KeptBullet[];
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const windowDays = Math.min(
    90,
    Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10) || 7)
  );

  try {
    const org = await getDefaultOrg();
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // Fetch all completed runs within window
    const runs = await prisma.platformMemorySynthesisRun.findMany({
      where: {
        orgId: org.id,
        completedAt: { not: null, gte: since },
      },
      orderBy: { completedAt: 'desc' },
    });

    if (runs.length === 0) {
      return NextResponse.json({
        runsCount: 0,
        sessionsScanned: 0,
        memoriesAnalyzed: 0,
        memoriesKept: 0,
        phantomsBlocked: 0,
        discarded: 0,
        windowDays,
        bullets: [],
      } satisfies KeeperSummaryResponse);
    }

    // Aggregate run-level counters
    let sessionsScanned = 0;
    let memoriesKept = 0;
    let phantomsBlocked = 0;
    let bulletsQuarantined = 0;

    for (const r of runs) {
      sessionsScanned    += r.sessionsScanned    ?? 0;
      memoriesKept       += (r.bulletsInserted   ?? 0) + (r.bulletsDeduped ?? 0);
      phantomsBlocked    += r.phantomsBlocked    ?? 0;
      bulletsQuarantined += r.bulletsQuarantined ?? 0;
    }

    // Pull candidatesProduced from detail rows (run-level doesn't have it)
    const runIds = runs.map((r) => r.id);
    const details = await prisma.platformMemorySynthesisDetail.findMany({
      where: { orgId: org.id, runId: { in: runIds } },
      select: { sessionId: true, candidatesProduced: true },
    });

    let memoriesAnalyzed = 0;
    for (const d of details) memoriesAnalyzed += d.candidatesProduced ?? 0;

    // discarded = candidates that were neither kept, quarantined, nor phantom-blocked
    const discarded = Math.max(0, memoriesAnalyzed - memoriesKept - phantomsBlocked - bulletsQuarantined);
    const sessionIds = [...new Set(details.map((d) => d.sessionId))];

    // Fetch active bullets sourced from any of these sessions, deduplicated
    const bullets = sessionIds.length > 0
      ? await prisma.platformAgentMemory.findMany({
          where: {
            orgId: org.id,
            status: 'ACTIVE',
            sourceSessionIds: { hasSome: sessionIds },
          },
          orderBy: [{ ruleType: 'asc' }, { confidence: 'desc' }],
        })
      : [];

    // Deduplicate by id (hasSome can return same bullet for multiple sessions)
    const seen = new Set<string>();
    const uniqueBullets: KeptBullet[] = [];
    for (const b of bullets) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        uniqueBullets.push({
          id: b.id,
          ruleText: b.ruleText,
          ruleType: b.ruleType,
          confidence: b.confidence,
          rationale: null,
          agentClass: b.agentClass ?? null,
          createdAt: b.createdAt.toISOString(),
        });
      }
    }

    return NextResponse.json({
      runsCount: runs.length,
      sessionsScanned,
      memoriesAnalyzed,
      memoriesKept,
      phantomsBlocked,
      discarded,
      windowDays,
      bullets: uniqueBullets,
    } satisfies KeeperSummaryResponse);
  } catch (err) {
    console.error('[keeper-summary GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
