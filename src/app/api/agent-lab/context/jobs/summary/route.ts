import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listJobKindSummaries, getCoverageSummary } from '@/lib/context/reads';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    // Additive (WS4): return estate-wide semantic coverage + degrade breakdown
    // alongside the existing per-kind summaries.
    const [data, coverage] = await Promise.all([
      listJobKindSummaries(org.id),
      getCoverageSummary(org.id),
    ]);
    return NextResponse.json({ data, coverage });
  } catch (err) {
    console.error('[context/jobs/summary GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
