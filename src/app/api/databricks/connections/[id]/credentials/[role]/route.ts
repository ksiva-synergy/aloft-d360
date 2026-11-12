import { NextRequest, NextResponse } from 'next/server';
import { denyUnless, requireRole } from '@/middleware/auth';
import prisma from '@/lib/db';
import { getOrgId, getConnection } from '@/lib/databricks/connections';
import { writeCredentials } from '@/lib/databricks/secrets';
import { evictToken } from '@/lib/databricks/token-client';
import { isDatabricksSpRole } from '@/lib/databricks/sp-roles';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string; role: string }> };

/** Set (create or replace) the service principal for one role. */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const denied = await denyUnless(req, (auth) => requireRole(auth, 'admin'));
  if (denied) return denied;

  const { id, role } = await params;
  if (!isDatabricksSpRole(role)) return NextResponse.json({ error: 'UNKNOWN_ROLE', role }, { status: 400 });

  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const body = await req.json() as Record<string, unknown>;
    if (typeof body.client_id !== 'string' || !body.client_id || typeof body.client_secret !== 'string' || !body.client_secret) {
      return NextResponse.json({ error: 'MISSING_FIELD', fields: ['client_id', 'client_secret'] }, { status: 400 });
    }
    const warehouseId = typeof body.warehouse_id === 'string' && body.warehouse_id.trim() ? body.warehouse_id.trim() : null;

    const secretRef = await writeCredentials(id, { client_id: body.client_id, client_secret: body.client_secret }, role);
    const row = await prisma.platformDatabricksCredential.upsert({
      where: { connection_id_role: { connection_id: id, role } },
      create: { connection_id: id, role, secret_ref: secretRef, warehouse_id: warehouseId },
      update: { secret_ref: secretRef, warehouse_id: warehouseId, status: 'untested', last_tested_at: null, last_error: null },
      select: { role: true, warehouse_id: true, status: true, updated_at: true },
    });
    evictToken(id);

    return NextResponse.json({ credential: row });
  } catch (err) {
    console.error('[databricks/connections/:id/credentials/:role PUT]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

/**
 * Stop using the role's own service principal; the role falls back to the
 * default credential. The secret stays in Secrets Manager for audit.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const denied = await denyUnless(req, (auth) => requireRole(auth, 'admin'));
  if (denied) return denied;

  const { id, role } = await params;
  if (!isDatabricksSpRole(role)) return NextResponse.json({ error: 'UNKNOWN_ROLE', role }, { status: 400 });

  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    await prisma.platformDatabricksCredential.updateMany({
      where: { connection_id: id, role },
      data: { status: 'disabled' },
    });
    evictToken(id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[databricks/connections/:id/credentials/:role DELETE]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
