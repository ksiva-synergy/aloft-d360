import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { OptionalReasonSchema } from '@/lib/access/column-admin';
import { commitDepartmentChange } from '@/lib/access/department-admin';

export const dynamic = 'force-dynamic';

/** Departments with the paths that belong to them and the groups that may use them. */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const departments = await prisma.accessDataDepartment.findMany({ where: { org_id: orgId, archived_at: null }, orderBy: { name: 'asc' } });
  const ids = departments.map((d) => d.id);
  const [paths, links] = ids.length
    ? await Promise.all([
        prisma.accessDepartmentPath.findMany({ where: { department_id: { in: ids } }, orderBy: { path: 'asc' } }),
        prisma.accessDepartmentGroup.findMany({ where: { department_id: { in: ids } } }),
      ])
    : [[], []];
  return ok({
    departments: departments.map((d) => ({
      id: d.id,
      key: d.key,
      name: d.name,
      description: d.description,
      paths: paths.filter((p) => p.department_id === d.id).map((p) => ({ id: p.id, path: p.path, depth: p.path_depth })),
      groups: links.filter((l) => l.department_id === d.id).map((l) => ({ groupId: l.group_id, allowExport: l.allow_export })),
    })),
  });
});

const CreateBody = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Use lowercase letters, numbers and underscores'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  reason: OptionalReasonSchema,
});

/** Create a department. It owns nothing and gives nobody access until data and groups are added. */
export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(CreateBody, await req.json());
  const clash = await prisma.accessDataDepartment.findUnique({ where: { org_id_key: { org_id: orgId, key: body.key } } });
  if (clash && !clash.archived_at) throw new ApiError(409, 'A department with that name already exists');
  let id = '';
  await commitDepartmentChange(orgId, async (tx) => {
    const row = clash
      ? await tx.accessDataDepartment.update({ where: { id: clash.id }, data: { name: body.name, description: body.description ?? null, archived_at: null } })
      : await tx.accessDataDepartment.create({ data: { org_id: orgId, key: body.key, name: body.name, description: body.description ?? null, created_by: auth.userId } });
    id = row.id;
  });
  await writeAudit({
    actorId: auth.userId,
    action: 'access.data_department.created',
    entityType: 'access_data_department',
    entityId: id,
    after: { name: body.name },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return created({ department: { id, key: body.key, name: body.name, description: body.description ?? null, paths: [], groups: [] } });
});
