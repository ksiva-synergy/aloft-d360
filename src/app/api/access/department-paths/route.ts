import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { OptionalReasonSchema } from '@/lib/access/column-admin';
import { assertActiveDepartment, assertNotWideningOwnAccess, commitDepartmentChange } from '@/lib/access/department-admin';

export const dynamic = 'force-dynamic';

const Body = z.object({ departmentId: z.string().min(1), path: z.string().min(1), reason: OptionalReasonSchema });

/** Say a catalog, schema or table belongs to a department. People in its linked groups can then use it. */
export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(Body, await req.json());
  const dept = await assertActiveDepartment(orgId, body.departmentId);
  const { path, pathDepth } = normalizeCatalogPath(body.path);
  await assertNotWideningOwnAccess(dept.id, auth);
  await commitDepartmentChange(orgId, async (tx) => {
    await tx.accessDepartmentPath.upsert({
      where: { department_id_path: { department_id: dept.id, path } },
      create: { org_id: orgId, department_id: dept.id, path, path_depth: pathDepth, reason: body.reason, created_by: auth.userId },
      update: { reason: body.reason },
    });
  });
  await writeAudit({
    actorId: auth.userId,
    action: 'access.data_department_path.added',
    entityType: 'access_data_department',
    entityId: dept.id,
    after: { department: dept.name, path },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return ok({ ok: true, path });
});

/** Remove a path from a department. Only narrows access. */
export const DELETE = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(Body, await req.json());
  const dept = await assertActiveDepartment(orgId, body.departmentId);
  const { path } = normalizeCatalogPath(body.path);
  await commitDepartmentChange(orgId, async (tx) => {
    await tx.accessDepartmentPath.deleteMany({ where: { department_id: dept.id, path } });
  });
  await writeAudit({
    actorId: auth.userId,
    action: 'access.data_department_path.removed',
    entityType: 'access_data_department',
    entityId: dept.id,
    before: { department: dept.name, path },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return ok({ ok: true, path });
});
