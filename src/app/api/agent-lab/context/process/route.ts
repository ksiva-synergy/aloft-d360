// POST /api/agent-lab/context/process
//
// Synchronous job orchestrator. Claims the oldest queued job for the default org
// and executes it inline. Returns the full job result when done.
//
// Currently handles: job_kind='mapping'
// Other job kinds return 422 (no handler registered — add cases as phases ship).
//
// INVARIANT: no warehouse access. All side effects go through platform_context_* tables.
// org_id always from getDefaultOrg().id — never hardcoded.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { claimNext, finalize } from '@/lib/context/queue';
import { runMappingJob } from '@/lib/context/mapping';
import type { MappingConfig } from '@/lib/context/mapping';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let orgId: string;
  try {
    const org = await getDefaultOrg();
    orgId = org.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Could not resolve org: ${msg}` }, { status: 500 });
  }

  try {
    const job = await claimNext(orgId);

    if (!job) {
      return NextResponse.json({ status: 'idle', message: 'No queued jobs for this org.' });
    }

    if (job.job_kind === 'mapping') {
      const rawScope = job.scope as Record<string, unknown> | null;
      const leftScope = typeof rawScope?.leftScope === 'string' ? rawScope.leftScope : '';
      const rightScope = typeof rawScope?.rightScope === 'string' ? rawScope.rightScope : '';

      if (!leftScope || !rightScope) {
        await finalize(job.id, 'failed', {}, 'Invalid scope: missing leftScope or rightScope');
        return NextResponse.json(
          { error: 'Job scope missing leftScope or rightScope.', job_id: job.id },
          { status: 422 },
        );
      }

      const config = rawScope?.config as MappingConfig | undefined;
      const result = await runMappingJob(job.id, orgId, { leftScope, rightScope, config });
      return NextResponse.json(result);
    }

    // Unknown job kind — mark failed and return 422
    await finalize(job.id, 'failed', {}, `no handler registered for job_kind: ${job.job_kind}`);
    return NextResponse.json(
      {
        error: `No handler registered for job_kind: '${job.job_kind}'.`,
        job_id: job.id,
        job_kind: job.job_kind,
      },
      { status: 422 },
    );
  } catch (err) {
    console.error('[context/process POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
