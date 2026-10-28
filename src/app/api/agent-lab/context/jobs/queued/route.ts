import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listQueuedJobs } from '@/lib/context/reads';
import { kickOrphanedQueuedJobs } from '@/lib/context/kick-queued-workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    void kickOrphanedQueuedJobs(org.id).catch((err) => {
      console.error('[kick-queued]', err instanceof Error ? err.message : err);
    });
    const items = await listQueuedJobs(org.id);
    return NextResponse.json({ data: items });
  } catch (err) {
    console.error('[context/jobs/queued GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
