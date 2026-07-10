import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/agent-lab/context/jobs/:id/children
 *
 * Returns all child jobs for a parent job (auto-split).
 * Ordered by child_index ASC.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;

  try {
    const org = await getDefaultOrg();

    const children = await prisma.platformContextJob.findMany({
      where: { parent_job_id: id, org_id: org.id },
      orderBy: [{ child_index: 'asc' }, { created_at: 'asc' }],
      select: {
        id: true,
        job_kind: true,
        status: true,
        child_index: true,
        scope: true,
        stats: true,
        error: true,
        started_at: true,
        finished_at: true,
        created_at: true,
      },
    });

    const counts = {
      total: children.length,
      queued: children.filter(c => c.status === 'queued').length,
      running: children.filter(c => c.status === 'running').length,
      succeeded: children.filter(c => c.status === 'succeeded').length,
      failed: children.filter(c => c.status === 'failed').length,
      partial: children.filter(c => c.status === 'partial').length,
    };

    return NextResponse.json({ children, counts });
  } catch (err) {
    console.error('[context/jobs/:id/children GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
