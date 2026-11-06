import { z } from 'zod';
import { handle, ok, parse } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { applyAccessPolicy } from '@/lib/access/apply-access-policy';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { requirePlatformAdminFor } from '@/lib/access/sensitive';

export const dynamic = 'force-dynamic';

const PolicyBody = z.object({
  userId: z.string().min(1),
  departmentIds: z.array(z.string().min(1)).default([]),
  clearance: z.enum(['internal', 'confidential', 'restricted']),
  grant: z
    .object({
      departmentId: z.string().min(1),
      path: z.string().min(1),
      level: z.enum(['discover', 'query', 'export']),
    })
    .nullable()
    .optional(),
});

/** Save a person's data policy: departments, clearance, optional department path grant. */
export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  // One-shot route that can set clearance and grants together; the console uses the
  // fine-grained routes instead, which check each change.
  requirePlatformAdminFor(auth, 'use the one-step policy route');
  const orgId = await getOrgId();
  const body = parse(PolicyBody, await req.json());

  const result = await applyAccessPolicy({
    orgId,
    actorUserId: auth.userId,
    userId: body.userId,
    departmentIds: body.departmentIds,
    clearance: body.clearance,
    grant: body.grant ?? null,
  });

  return ok({ result });
});
