import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { launchChildTask, type JobKind } from '@/lib/context/queue';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agent-lab/context/jobs/:id/kick
 *
 * Launches a Fargate container for a single queued job.
 * Works for any job kind — parent or child (t4_dim_propose, t4_entity_propose, etc.).
 * Returns 409 if the job is not in a kickable state (not queued).
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;

  try {
    const org = await getDefaultOrg();

    const job = await prisma.platformContextJob.findFirst({
      where: { id, org_id: org.id },
      select: { id: true, job_kind: true, status: true },
    });

    if (!job) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    if (job.status !== 'queued') {
      return NextResponse.json(
        { error: 'NOT_KICKABLE', message: `Job is ${job.status} — only queued jobs can be kicked.` },
        { status: 409 },
      );
    }

    const taskId = await launchChildTask(job.id, job.job_kind as JobKind, org.id);

    return NextResponse.json({ launched: !!taskId, task_id: taskId ?? null });
  } catch (err) {
    console.error('[context/jobs/:id/kick POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
