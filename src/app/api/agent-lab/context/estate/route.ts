import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { listEstateObjects } from '@/lib/context/reads';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const orgId = await getOrgId();
    const sp = req.nextUrl.searchParams;

    const result = await listEstateObjects(orgId, {
      page: sp.has('page') ? Number(sp.get('page')) : undefined,
      pageSize: sp.has('pageSize') ? Number(sp.get('pageSize')) : undefined,
      catalog: sp.get('catalog') ?? undefined,
      schema: sp.get('schema') ?? undefined,
      kind: sp.get('kind') ?? undefined,
      harvest: (sp.get('harvest') as 'none' | 'scheduled' | 'queued' | 'harvested' | 'inaccessible') ?? undefined,
      q: sp.get('q') ?? undefined,
      excludeTestSources: sp.get('excludeTestSources') === 'true',
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[context/estate GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
