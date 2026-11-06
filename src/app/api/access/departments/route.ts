import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { normalizeDepartmentKey } from '@/lib/access/paths';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { listDepartmentSummaries } from '@/lib/access/principal';
import { requireAccessAdmin, serializeDepartment } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const rows = await listDepartmentSummaries(orgId);
  return ok({ departments: rows.map(serializeDepartment) });
});

const CreateDepartment = z.object({
  key: z.string().min(2),
  name: z.string().min(2),
  entraGroupId: z.string().optional().nullable(),
});

export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(CreateDepartment, await req.json());
  const key = normalizeDepartmentKey(body.key);

  const dept = await prisma.$transaction(async (tx) => {
    const row = await tx.accessDepartment.create({
      data: {
        org_id: orgId,
        key,
        name: body.name.trim(),
        entra_group_id: body.entraGroupId ?? null,
      },
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });

  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.department.created',
    entityType: 'access_department',
    entityId: dept.id,
    after: { key: dept.key, name: dept.name },
    ...clientMeta(req),
  });

  return created({ department: serializeDepartment(dept) });
});
