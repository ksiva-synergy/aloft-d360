import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAgentOpsAuth } from '@/lib/agent-ops/access';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await getAgentOpsAuth();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  const [suites, recentRuns] = await Promise.all([
    prisma.platformEvalSuite.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { _count: { select: { cases: true } } },
    }),
    prisma.platformEvalRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { suite: { select: { id: true, name: true } } },
    }),
  ]);

  return NextResponse.json({ suites, runs: recentRuns });
}

export async function POST(request: NextRequest) {
  const auth = await getAgentOpsAuth();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  const body = await request.json() as { suiteId?: string; agentId?: string };
  if (!body.suiteId) {
    return NextResponse.json({ error: 'suiteId required' }, { status: 400 });
  }

  const run = await prisma.platformEvalRun.create({
    data: {
      suiteId: body.suiteId,
      agentId: body.agentId ?? null,
      triggeredBy: auth.userId,
      status: 'queued',
      startedAt: new Date(),
    },
  });

  return NextResponse.json({ run, note: 'Eval runner hooks into Boost — execute cases via Performance Lab.' });
}
