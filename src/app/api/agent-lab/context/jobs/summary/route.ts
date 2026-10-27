import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { listJobKindSummaries, getCoverageSummary } from '@/lib/context/reads';

export const dynamic = 'force-dynamic';

/** Pollers pass `coverage=false` to skip heavy estate rollup queries. */
function includeCoverage(req: NextRequest): boolean {
  const raw = req.nextUrl.searchParams.get('coverage');
  if (raw === 'false' || raw === '0') return false;
  return true;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const orgId = await getOrgId();
    const withCoverage = includeCoverage(req);

    const data = await listJobKindSummaries(orgId);
    if (!withCoverage) {
      return NextResponse.json({ data });
    }

    const coverage = await getCoverageSummary(orgId);
    return NextResponse.json({ data, coverage });
  } catch (err) {
    console.error('[context/jobs/summary GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
