import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { planSplit, TIME_BUDGET_MINUTES, MAX_CONCURRENT_TASKS, MAX_CONCURRENT_BY_KIND, RATE_PER_MINUTE, type JobKind } from '@/lib/context/queue';

export const dynamic = 'force-dynamic';

// Cost is derived by planSplit() (rolling average of recent t2 jobs, see
// queue.ts / cost-model.ts) and returned as plan.estimatedCostUsd — no local
// per-object constant here.

/**
 * POST /api/agent-lab/context/jobs/plan
 *
 * Preview what auto-split would produce for a given scope without launching anything.
 * Used by the confirm modal to show chunk count, wall-clock estimate and cost.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const kind: JobKind = body.kind as JobKind;
  const excludeSchemas: string[] = Array.isArray(body.excludeSchemas) ? body.excludeSchemas : [];
  const includePatterns: string[] = Array.isArray(body.includePatterns) ? body.includePatterns : [];

  if (!kind) return NextResponse.json({ error: 'MISSING_KIND' }, { status: 400 });

  try {
    const orgId = await getOrgId();
    const source = await prisma.platformContextSource.findFirst({
      where: { org_id: orgId, status: 'active' },
      select: { id: true },
    });

    if (!source) {
      return NextResponse.json({ needsSplit: false, totalObjects: 0, chunks: 0 });
    }

    const plan = await planSplit(orgId, kind, source.id, { excludeSchemas, includePatterns });
    const maxConcurrent = (MAX_CONCURRENT_BY_KIND as Record<string, number>)[kind] ?? MAX_CONCURRENT_TASKS;
    const rate = RATE_PER_MINUTE[kind] ?? 25;

    return NextResponse.json({
      needsSplit: plan.needsSplit,
      totalObjects: plan.totalObjects,
      chunks: plan.partitions.length || 1,
      maxObjectsPerChunk: plan.maxObjectsPerChild,
      timeBudgetMinutes: TIME_BUDGET_MINUTES,
      estimatedMinutesPerChunk: TIME_BUDGET_MINUTES,
      estimatedWallClockMinutes: plan.estimatedWallClockMinutes || Math.ceil(plan.totalObjects / rate),
      estimatedCostUsd: plan.estimatedCostUsd,
      maxConcurrent,
    });
  } catch (err) {
    console.error('[context/jobs/plan POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
