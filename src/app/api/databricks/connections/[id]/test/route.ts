import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId, getConnection } from '@/lib/databricks/connections';
import { testConnection } from '@/lib/databricks/test-connection';
import { syncToolEntry } from '@/lib/databricks/tool-registration';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const result = await testConnection(id);

    // Reflect active/error status on the tool catalog entry
    const updated = await getConnection(orgId, id);
    if (updated) await syncToolEntry(updated);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[databricks/connections/:id/test POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
