import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { pathToIncludePattern } from '@/lib/context/job-scope';
import { enqueueAndLaunchHarvest, findScopedHarvestConflict } from '@/lib/context/enqueue-and-launch';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
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
    const orgId = org.id;

    const object = await prisma.platformContextObject.findFirst({
      where: { id, org_id: orgId },
      select: { source_id: true, full_path: true },
    });

    if (!object) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const activeJob = await findScopedHarvestConflict(
      object.source_id,
      't1_profile',
      object.full_path,
    );

    if (activeJob) {
      return NextResponse.json(
        { data: { jobId: activeJob.id }, queued: false, reason: 'debounced' },
        { status: 202 },
      );
    }

    const scope = { includePatterns: [pathToIncludePattern(object.full_path)] };
    const { job, launched } = await enqueueAndLaunchHarvest(
      't1_profile',
      object.source_id,
      scope,
      orgId,
    );

    return NextResponse.json(
      { data: { jobId: job.id, launched }, queued: true },
      { status: 202 },
    );
  } catch (err) {
    console.error('[context/objects/:id/refresh POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
