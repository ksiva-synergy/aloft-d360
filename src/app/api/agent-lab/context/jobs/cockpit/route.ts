import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { getJobRecommendations } from '@/lib/estate/cockpit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const orgId = await getOrgId();
    const sourceId = req.nextUrl.searchParams.get('sourceId') ?? undefined;
    const { health, primary } = await getJobRecommendations(orgId, sourceId || undefined);
    return NextResponse.json({ health, recommendation: primary });
  } catch (err) {
    console.error('[context/jobs/cockpit GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
