import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { listEstateFacets } from '@/lib/context/reads';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const orgId = await getOrgId();
    const sp = req.nextUrl.searchParams;
    const result = await listEstateFacets(orgId, {
      excludeTestSources: sp.get('excludeTestSources') === 'true',
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[context/estate/facets GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
