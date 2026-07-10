import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getJob } from '@/lib/context/reads';
import prisma from '@/lib/db';

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
 * Cancel a queued job. Only jobs with status='queued' can be cancelled.
 * Running jobs cannot be cancelled via this endpoint.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
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

    const job = await prisma.platformContextJob.findFirst({
      where: { id, org_id: org.id },
      select: { id: true, status: true, job_kind: true },
    });

    if (!job) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    if (job.status !== 'queued') {
      return NextResponse.json(
        { error: 'CANNOT_CANCEL', message: `Job is ${job.status}, only queued jobs can be cancelled.` },
        { status: 409 },
      );
    }

    await prisma.platformContextJob.update({
      where: { id },
      data: { status: 'failed', error: 'Cancelled by user', finished_at: new Date() },
    });

    return NextResponse.json({ id, status: 'cancelled' });
  } catch (err) {
    console.error('[context/jobs/:id DELETE]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
