import { prisma } from '@/lib/db';
import { handle, ok, ApiError } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { personAccessSummary } from '@/lib/access/person-summary';

export const dynamic = 'force-dynamic';

/**
 * What one person can use and see, and why (simplified model):
 *   groups      their groups (with end dates) and built-in groups from their app roles
 *   rules       every access rule that applies to them, and through which holder
 *   protections every protection with their level and through which holder
 */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) throw new ApiError(400, 'Pass userId');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
  if (!user) throw new ApiError(404, 'User not found');
  const summary = await personAccessSummary(orgId, userId);
  return ok({
    person: { id: user.id, email: user.email, name: user.name, roles: summary.roles },
    groups: summary.groups,
    builtins: summary.builtins,
    rules: summary.rules,
    protections: summary.protections,
  });
});
