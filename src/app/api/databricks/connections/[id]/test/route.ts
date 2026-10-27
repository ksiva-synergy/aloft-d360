import { NextRequest, NextResponse } from 'next/server';
import { denyUnless, requireRole } from '@/middleware/auth';
import { getOrgId, getConnection } from '@/lib/databricks/connections';
import { testConnection } from '@/lib/databricks/test-connection';
import { syncToolEntry } from '@/lib/databricks/tool-registration';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const denied = await denyUnless(req, (auth) => requireRole(auth, 'admin'));
  if (denied) return denied;

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
