import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { getCurrentTopicMap } from '@/lib/foer/topics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();

    // Get all synthesis details for this org
    const details = await prisma.platformMemorySynthesisDetail.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'desc' },
    });

    if (details.length === 0) {
      return NextResponse.json({ sessions: [] });
    }

    // Get trace node presence to confirm showable (has both details AND trace graph)
    const sessionIds = details.map((d) => d.sessionId);
    const traceSessions = await prisma.platformTraceNode.groupBy({
      by: ['sessionId'],
      where: {
        orgId: org.id,
        sessionId: { in: sessionIds },
      },
    });

    const activeSessionIds = new Set(traceSessions.map((t) => t.sessionId));
    const showableDetails = details.filter((d) => activeSessionIds.has(d.sessionId));

    // Get current topic map for taskSignature joins
    const topicMap = await getCurrentTopicMap(org.id);

    const result = showableDetails.map((d) => {
      const topic = d.taskSignature ? topicMap.get(d.taskSignature) : null;
      return {
        sessionId: d.sessionId,
        agentClass: d.agentClass,
        taskSignature: d.taskSignature,
        candidatesProduced: d.candidatesProduced,
        bulletsInserted: d.bulletsInserted,
        bulletsDeduped: d.bulletsDeduped,
        bulletsSuperseded: d.bulletsSuperseded,
        phantomsBlocked: d.phantomsBlocked,
        completedAt: d.createdAt.toISOString(),
        topicKey: topic?.topicKey ?? null,
        topicName: topic?.topicName ?? null,
      };
    });

    return NextResponse.json({ sessions: result });
  } catch (err) {
    console.error('[sessions GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
