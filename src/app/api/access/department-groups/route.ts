import { z } from 'zod';
import { handle, ok, parse, clientMeta } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { OptionalReasonSchema, assertActiveGroup } from '@/lib/access/column-admin';
import { assertActiveDepartment, assertNotWideningOwnAccess, commitDepartmentChange } from '@/lib/access/department-admin';

export const dynamic = 'force-dynamic';

const LinkBody = z.object({ departmentId: z.string().min(1), groupId: z.string().min(1), allowExport: z.boolean().optional(), reason: OptionalReasonSchema });

/** Let a group of people use everything that belongs to a department (Use, or Use + export). */
export const PUT = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(LinkBody, await req.json());
  const dept = await assertActiveDepartment(orgId, body.departmentId);
  await assertActiveGroup(orgId, body.groupId);
  await assertNotWideningOwnAccess(dept.id, auth, body.groupId);
  const allowExport = !!body.allowExport;
  await commitDepartmentChange(orgId, async (tx) => {
    await tx.accessDepartmentGroup.upsert({
      where: { department_id_group_id: { department_id: dept.id, group_id: body.groupId } },
      create: { department_id: dept.id, group_id: body.groupId, allow_export: allowExport, created_by: auth.userId },
      update: { allow_export: allowExport },
    });
  });
  await writeAudit({
    actorId: auth.userId,
    action: 'access.data_department_group.set',
    entityType: 'access_data_department',
    entityId: dept.id,
    after: { department: dept.name, groupId: body.groupId, access: allowExport ? 'export' : 'use' },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});

const UnlinkBody = z.object({ departmentId: z.string().min(1), groupId: z.string().min(1), reason: OptionalReasonSchema });

/** Stop a group using a department's data. Only narrows access. */
export const DELETE = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(UnlinkBody, await req.json());
  const dept = await assertActiveDepartment(orgId, body.departmentId);
  await commitDepartmentChange(orgId, async (tx) => {
    await tx.accessDepartmentGroup.deleteMany({ where: { department_id: dept.id, group_id: body.groupId } });
  });
  await writeAudit({
    actorId: auth.userId,
    action: 'access.data_department_group.removed',
    entityType: 'access_data_department',
    entityId: dept.id,
    before: { department: dept.name, groupId: body.groupId },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});
