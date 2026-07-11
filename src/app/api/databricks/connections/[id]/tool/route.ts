import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId, getConnection } from '@/lib/databricks/connections';
import { getToolEntry } from '@/lib/databricks/tool-registration';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const tool = await getToolEntry(id);
    return NextResponse.json({ tool });
  } catch (err) {
    console.error('[databricks/connections/:id/tool GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
