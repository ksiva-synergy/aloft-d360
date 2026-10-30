import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getJob } from '@/lib/context/reads';
import prisma from '@/lib/db';
import { denyUnlessEstatePipelineOperator } from '@/lib/estate/require-estate-pipeline-operator';
import { stopHarvesterTask } from '@/lib/context/launch-harvester';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'BAD_REQUEST', field: 'id' }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();
    const result = await getJob(org.id, id);
    if (!result) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[context/jobs/:id GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

/**
 * DELETE /api/agent-lab/context/jobs/:id
 *
 * Cancel queued/running/orchestrating jobs. When a Fargate/local worker is attached,
 * attempts StopTask / SIGTERM then marks the job failed (cancelled).
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const denied = await denyUnlessEstatePipelineOperator();
  if (denied) return denied;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'BAD_REQUEST', field: 'id' }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();

    const job = await prisma.platformContextJob.findFirst({
      where: { id, org_id: org.id },
      select: { id: true, status: true, job_kind: true, scope: true },
    });

    if (!job) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const scope = (job.scope ?? {}) as Record<string, unknown>;
    const hasWorker = typeof scope.fargate_task_id === 'string' && scope.fargate_task_id.length > 0;
    const active = ['queued', 'running', 'orchestrating'].includes(job.status);

    if (!active) {
      return NextResponse.json(
        { error: 'CANNOT_CANCEL', message: `Job is ${job.status} and cannot be cancelled.` },
        { status: 409 },
      );
    }

    let workerStop: { stopped: boolean; error?: string } | undefined;
    if (hasWorker) {
      workerStop = await stopHarvesterTask(String(scope.fargate_task_id), 'Cancelled by user (Estate UI)');
    }

    await prisma.platformContextJob.update({
      where: { id },
      data: { status: 'failed', error: 'Cancelled by user', finished_at: new Date() },
    });

    return NextResponse.json({
      id,
      status: 'cancelled',
      ...(workerStop ? { worker_stop: workerStop } : {}),
    });
  } catch (err) {
    console.error('[context/jobs/:id DELETE]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
