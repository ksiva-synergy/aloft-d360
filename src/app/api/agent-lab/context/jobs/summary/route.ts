import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { listJobKindSummaries, getCoverageSummary } from '@/lib/context/reads';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

/** Pollers pass `coverage=false` to skip heavy estate rollup queries.
 *  Optional: `days=N` windows counts to the last N days (active counts are never windowed);
 *  `detail=true` adds recent runs, median duration, partial/cancelled and previous-window counts. */
function includeCoverage(req: NextRequest): boolean {
  const raw = req.nextUrl.searchParams.get('coverage');
  if (raw === 'false' || raw === '0') return false;
  return true;
}

export async function GET(req: NextRequest) {
  const deniedSection = await denyUnlessSection(req, ['estate.jobs', 'view']);
  if (deniedSection) return deniedSection;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const orgId = await getOrgId();
    const withCoverage = includeCoverage(req);
    const sp = req.nextUrl.searchParams;
    const rawDays = Number(sp.get('days'));
    const sinceDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 3650) : null;
    const detail = sp.get('detail') === 'true' || sp.get('detail') === '1';

    const data = await listJobKindSummaries(orgId, { sinceDays, detail });
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
