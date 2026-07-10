// POST /api/agent-lab/context/mappings/run
//
// Enqueues a cross-schema mapping job (job_kind='mapping') for the default org.
// Returns 202 immediately with { job_id, status: 'queued' }.
// To run the job synchronously, follow up with POST /api/agent-lab/context/process.
// Nothing here sets status='confirmed' — proposals only (CH7 invariant).
//
// INVARIANT: no warehouse access. Writes to platform_context_jobs only.
// org_id always from getDefaultOrg().id — never hardcoded.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { enqueue } from '@/lib/context/queue';
import type { MappingConfig } from '@/lib/context/mapping';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  let left = body.left as { sourceId: string; pathGlob: string } | undefined;
  let right = body.right as { sourceId: string; pathGlob: string } | undefined;
  const includeRejected = body.includeRejected === true;

  // Fallback for old payload shape { leftSourceId, rightSourceId }
  if (!left && typeof body.leftSourceId === 'string') {
    left = { sourceId: body.leftSourceId.trim(), pathGlob: '*' };
  }
  if (!right && typeof body.rightSourceId === 'string') {
    right = { sourceId: body.rightSourceId.trim(), pathGlob: '*' };
  }

  const config = (body.config as MappingConfig | undefined) ?? undefined;

  let orgId: string;
  try {
    const org = await getDefaultOrg();
    orgId = org.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Could not resolve org: ${msg}` }, { status: 500 });
  }

  const jobScope: Record<string, any> = {
    ...(config !== undefined ? { config } : {}),
  };

  if (left && right) {
    if (!left.sourceId || !left.pathGlob || !right.sourceId || !right.pathGlob) {
      return NextResponse.json(
        { error: "Left and right scopes must contain non-empty 'sourceId' and 'pathGlob' strings." },
        { status: 400 },
      );
    }

    // Identical-pair guard
    if (left.sourceId === right.sourceId && left.pathGlob === right.pathGlob) {
      return NextResponse.json(
        { error: 'Cannot map a schema to itself' },
        { status: 400 },
      );
    }

    jobScope.left = left;
    jobScope.right = right;
    jobScope.includeRejected = includeRejected;
    // Set leftScope and rightScope for compatibility with /context/process route checks
    jobScope.leftScope = `${left.sourceId}:${left.pathGlob}`;
    jobScope.rightScope = `${right.sourceId}:${right.pathGlob}`;
  } else {
    const leftScope = typeof body.leftScope === 'string' ? body.leftScope.trim() : '';
    const rightScope = typeof body.rightScope === 'string' ? body.rightScope.trim() : '';

    if (!leftScope || !rightScope) {
      return NextResponse.json(
        { error: "Body must contain left/right glob definitions or non-empty 'leftScope' and 'rightScope' strings." },
        { status: 400 },
      );
    }

    jobScope.leftScope = leftScope;
    jobScope.rightScope = rightScope;
  }

  try {
    const job = await enqueue('mapping', null, jobScope, 'on_demand', orgId);

    return NextResponse.json(
      {
        job_id: job.id,
        status: 'queued',
        leftScope: jobScope.leftScope,
        rightScope: jobScope.rightScope,
      },
      { status: 202 },
    );
  } catch (err) {
    console.error('[context/mappings/run POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
