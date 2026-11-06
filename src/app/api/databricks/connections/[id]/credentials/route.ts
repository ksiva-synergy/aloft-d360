import { NextRequest, NextResponse } from 'next/server';
import { denyUnless, requireRole } from '@/middleware/auth';
import prisma from '@/lib/db';
import { getOrgId, getConnection } from '@/lib/databricks/connections';
import {
  DATABRICKS_SP_ROLES,
  DATABRICKS_SP_ROLE_LABELS,
  listRoleBindings,
  requiredRoles,
} from '@/lib/databricks/sp-roles';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/** Every service principal role on the connection and whether it has its own credential. */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const denied = await denyUnless(req, (auth) => requireRole(auth, 'admin'));
  if (denied) return denied;

  const { id } = await params;
  try {
    const orgId = await getOrgId();
    const conn = await getConnection(orgId, id);
    if (!conn) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const bindings = await listRoleBindings(id);
    const rows = await prisma.platformDatabricksCredential.findMany({
      where: { connection_id: id },
      select: { role: true, warehouse_id: true, status: true, last_tested_at: true, last_error: true, updated_at: true },
    }).catch((err: unknown) => {
      if ((err as { code?: unknown })?.code === 'P2021') return [];
      throw err;
    });
    const rowByRole = new Map(rows.map((r) => [r.role, r] as const));
    const required = requiredRoles();

    const roles = DATABRICKS_SP_ROLES.map((role) => {
      const binding = bindings.get(role);
      const row = rowByRole.get(role);
      return {
        role,
        label: DATABRICKS_SP_ROLE_LABELS[role],
        credential: binding ? binding.source : 'default',
        required: required.has(role),
        warehouse_id: row?.warehouse_id ?? null,
        status: row?.status ?? null,
        last_tested_at: row?.last_tested_at ?? null,
        last_error: row?.last_error ?? null,
        updated_at: row?.updated_at ?? null,
      };
    });

    return NextResponse.json({ connection_id: id, roles });
  } catch (err) {
    console.error('[databricks/connections/:id/credentials GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
