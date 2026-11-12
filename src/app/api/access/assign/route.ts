import { z } from 'zod';
import { handle, created, parse } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { applyDataRoleToUser } from '@/lib/access/apply-data-role';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { requirePlatformAdminFor } from '@/lib/access/sensitive';

export const dynamic = 'force-dynamic';

const AssignBody = z.object({
  userId: z.string().min(1),
  templateKey: z.string().min(1),
  departmentId: z.string().optional(),
  catalogPath: z.string().optional(),
});

/** Apply a built-in data role template to a user (department, grants, clearance). */
export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  // One-shot route that can set clearance and grants together; the console uses the
  // fine-grained routes instead, which check each change.
  requirePlatformAdminFor(auth, 'use the one-step policy route');
  const orgId = await getOrgId();
  const body = parse(AssignBody, await req.json());

  const result = await applyDataRoleToUser({
    orgId,
    actorUserId: auth.userId,
    userId: body.userId,
    templateKey: body.templateKey,
    departmentId: body.departmentId,
    catalogPath: body.catalogPath,
  });

  return created({ result });
});
