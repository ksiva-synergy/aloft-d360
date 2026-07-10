import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { enqueue, type JobKind } from '@/lib/context/queue';

export const dynamic = 'force-dynamic';

const VALID_KINDS: JobKind[] = [
  'change_detect',
  't0_structural',
  't1_profile',
  't2_semantic',
  'embed',
  'mapping',
  'silo_scan',
  'recompute_entity_tags',
  'estate_inventory',
  'knowledge_sync',
];

/**
 * POST /api/agent-lab/context/jobs/trigger
 *
 * Enqueue an on-demand job of any supported kind.
 * Body: { kind: JobKind, source_id?: string, scope?: object }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json();
  const kind = body.kind as string;

  if (!kind || !VALID_KINDS.includes(kind as JobKind)) {
    return NextResponse.json(
      { error: 'INVALID_KIND', valid: VALID_KINDS },
      { status: 400 },
    );
  }

  try {
    const orgId = await getOrgId();

    let sourceId: string | null = body.source_id ?? null;

    if (!sourceId && ['t0_structural', 't1_profile', 't2_semantic', 'embed'].includes(kind)) {
      const firstSource = await prisma.platformContextSource.findFirst({
        where: { org_id: orgId, status: 'active' },
        select: { id: true },
        orderBy: { created_at: 'asc' },
      });
      sourceId = firstSource?.id ?? null;
    }

    const scope = body.scope ?? null;
    const job = await enqueue(kind as JobKind, sourceId, scope, 'on_demand', orgId);

    return NextResponse.json(
      { job_id: job.id, kind: job.job_kind, status: 'queued' },
      { status: 202 },
    );
  } catch (err) {
    console.error('[context/jobs/trigger POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
