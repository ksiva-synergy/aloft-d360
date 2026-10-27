import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { type JobKind } from '@/lib/context/queue';
import { enqueueAndLaunchHarvest, normalizeJobScope } from '@/lib/context/enqueue-and-launch';

export const dynamic = 'force-dynamic';

const VALID_KINDS: JobKind[] = [
  'change_detect',
  't0_structural',
  't1_profile',
  't2_semantic',
  'embed',
  'silo_scan',
  'recompute_entity_tags',
  'estate_inventory',
  't3_usage',
  'knowledge_sync',
];

const STUB_KINDS = new Set<JobKind>(['mapping', 't3_connected', 't4_scan']);

/**
 * POST /api/agent-lab/context/jobs/trigger
 *
 * Enqueue an on-demand job and launch a harvest worker (same as launch, single-kind).
 * Body: { kind: JobKind, source_id?: string, scope?: object }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json();
  const kind = body.kind as string;

  if (!kind || !VALID_KINDS.includes(kind as JobKind)) {
    if (STUB_KINDS.has(kind as JobKind)) {
      return NextResponse.json(
        { error: 'KIND_NOT_AVAILABLE', message: `${kind} is not available from trigger; use Jobs launch when enabled.` },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'INVALID_KIND', valid: VALID_KINDS },
      { status: 400 },
    );
  }

  try {
    const orgId = await getOrgId();

    let sourceId: string | null = body.source_id ?? null;

    if (!sourceId && ['t0_structural', 't1_profile', 't2_semantic', 'embed', 'estate_inventory', 't3_usage'].includes(kind)) {
      const firstSource = await prisma.platformContextSource.findFirst({
        where: { org_id: orgId, status: 'active' },
        select: { id: true },
        orderBy: { created_at: 'asc' },
      });
      sourceId = firstSource?.id ?? null;
    }

    if (!sourceId) {
      return NextResponse.json({ error: 'MISSING_SOURCE' }, { status: 400 });
    }

    const scope = normalizeJobScope(
      body.scope && typeof body.scope === 'object' ? (body.scope as Record<string, unknown>) : null,
    );

    const { job, launched, taskArn, error } = await enqueueAndLaunchHarvest(
      kind as JobKind,
      sourceId,
      scope,
      orgId,
    );

    return NextResponse.json(
      {
        job_id: job.id,
        kind: job.job_kind,
        status: 'queued',
        launched,
        task_arn: taskArn,
        launch_error: error ?? null,
      },
      { status: 202 },
    );
  } catch (err) {
    console.error('[context/jobs/trigger POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
