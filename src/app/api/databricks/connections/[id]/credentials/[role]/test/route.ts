import { NextRequest, NextResponse } from 'next/server';
import { denyUnless, requireRole } from '@/middleware/auth';
import { getOrgId, getConnection } from '@/lib/databricks/connections';
import { isDatabricksSpRole, listRoleBindings } from '@/lib/databricks/sp-roles';
import { testRoleCredential } from '@/lib/databricks/test-connection';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string; role: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const denied = await denyUnless(req, (auth) => requireRole(auth, 'admin'));
  if (denied) return denied;

  const { id, role } = await params;
  if (!isDatabricksSpRole(role)) return NextResponse.json({ error: 'UNKNOWN_ROLE', role }, { status: 400 });

  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    if (!(await listRoleBindings(id)).has(role)) {
      return NextResponse.json({ error: 'NO_ROLE_CREDENTIAL', role }, { status: 404 });
    }

    return NextResponse.json(await testRoleCredential(id, role));
  } catch (err) {
    console.error('[databricks/connections/:id/credentials/:role/test POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
