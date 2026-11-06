import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { kickOrphanedQueuedJobs } from '@/lib/context/kick-queued-workers';
import { denyUnlessEstatePipelineOperator } from '@/lib/estate/require-estate-pipeline-operator';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-lab/context/jobs/kick-queued
 *
 * Explicitly launch workers for orphaned queued jobs (no silent side effect).
 */
export async function POST() {
  const denied = await denyUnlessEstatePipelineOperator();
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    await kickOrphanedQueuedJobs(orgId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[context/jobs/kick-queued POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
