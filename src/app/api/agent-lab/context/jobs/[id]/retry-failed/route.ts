import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { launchChildTask, type JobKind } from '@/lib/context/queue';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agent-lab/context/jobs/:id/retry-failed
 *
 * Re-queues all failed child jobs of a parent and launches Fargate tasks for them.
 * Also resets the parent to 'orchestrating' if it had finalized with failures.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;

  try {
    const org = await getDefaultOrg();

    const parent = await prisma.platformContextJob.findFirst({
      where: { id, org_id: org.id },
    });

    if (!parent) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (!parent.status.match(/^(partial|failed)$/)) {
      return NextResponse.json(
        { error: 'CANNOT_RETRY', message: `Parent is ${parent.status}, only partial/failed parents can be retried.` },
        { status: 409 },
      );
    }

    // Find all failed children
    const failedChildren = await prisma.platformContextJob.findMany({
      where: { parent_job_id: id, org_id: org.id, status: 'failed' },
      select: { id: true, job_kind: true },
    });

    if (failedChildren.length === 0) {
      return NextResponse.json({ retried: 0 });
    }

    // Re-queue failed children
    await prisma.platformContextJob.updateMany({
      where: { parent_job_id: id, org_id: org.id, status: 'failed' },
      data: { status: 'queued', error: null, started_at: null, finished_at: null },
    });

    // Reset parent to orchestrating
    await prisma.platformContextJob.update({
      where: { id },
      data: { status: 'orchestrating', finished_at: null, error: null },
    });

    // Launch Fargate tasks for the re-queued children
    const kind = failedChildren[0].job_kind as JobKind;
    const launched: string[] = [];

    for (const child of failedChildren) {
      try {
        const taskId = await launchChildTask(child.id, kind, org.id);
        if (taskId) launched.push(taskId);
      } catch (err) {
        console.error(`[retry-failed] failed to launch task for child ${child.id}:`, err);
      }
    }

    return NextResponse.json({
      retried: failedChildren.length,
      launched: launched.length,
    });
  } catch (err) {
    console.error('[context/jobs/:id/retry-failed POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
