import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { enqueueAndLaunchHarvest } from '@/lib/context/enqueue-and-launch';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;

  try {
    const orgId = await getOrgId();

    const source = await prisma.platformContextSource.findFirst({
      where: { id, org_id: orgId },
      select: { id: true },
    });
    if (!source) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const { job, launched, taskArn, error } = await enqueueAndLaunchHarvest(
      'estate_inventory',
      id,
      null,
      orgId,
    );
    return NextResponse.json(
      { job_id: job.id, status: 'queued', launched, task_arn: taskArn, launch_error: error ?? null },
      { status: 202 },
    );
  } catch (err) {
    console.error('[context/sources/:id/inventory POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
