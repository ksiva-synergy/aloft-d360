import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agent-lab/context/sources/[id]/refresh
 * Body: { path?: string }
 *
 * Enqueues a t1_profile job for the source, scoped to the given object path.
 * Debounced: if any queued or running job already exists for this source,
 * returns the existing job_id and skips enqueueing.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;

  let path: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    path = typeof body?.path === 'string' ? body.path : null;
  } catch {
    // body optional
  }

  try {
    const orgId = await getOrgId();

    const source = await prisma.platformContextSource.findFirst({
      where: { id, org_id: orgId },
      select: { id: true },
    });
    if (!source) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    // Debounce: skip if any active job for this source is already queued or running
    const activeJob = await prisma.platformContextJob.findFirst({
      where: { source_id: id, status: { in: ['queued', 'running'] } },
      select: { id: true },
      orderBy: { created_at: 'asc' },
    });
    if (activeJob) {
      return NextResponse.json(
        { job_id: activeJob.id, queued: false, reason: 'debounced' },
        { status: 200 },
      );
    }

    const scope = path ? { path } : null;
    const job = await enqueue('t1_profile', id, scope, 'on_demand', orgId);
    return NextResponse.json({ job_id: job.id, queued: true }, { status: 202 });
  } catch (err) {
    console.error('[context/sources/:id/refresh POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
