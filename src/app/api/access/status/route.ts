import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { accessMode, enforcedSurfaces } from '@/lib/access/config';
import { loadPolicySnapshot } from '@/lib/access/policy-store';
import { withAccessDbRetry } from '@/lib/access/guards';
import { isPlatformAdminRole } from '@/lib/access/sensitive';
import { resolveRoleLabel, roleRank } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/** Rollout state and counts for the Data access overview and setup checklist. */
export const GET = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const policy = await loadPolicySnapshot(orgId);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [departments, people, decisions7d, denies7d, roles] = await withAccessDbRetry(() =>
    Promise.all([
      prisma.accessDepartment.count({ where: { org_id: orgId, archived_at: null } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.accessDecisionLog.count({ where: { org_id: orgId, ts: { gte: since } } }).catch(() => 0),
      prisma.accessDecisionLog
        .count({ where: { org_id: orgId, ts: { gte: since }, decision: 'deny' } })
        .catch(() => 0),
      prisma.role.findMany({
        select: { name: true, _count: { select: { users: true } } },
      }),
    ]),
  );

  const departmentGrants = policy.grants.filter((g) => g.principalType === 'department');
  const mode = accessMode();

  return ok({
    me: { userId: auth.userId, platformAdmin: isPlatformAdminRole(auth.role) },
    roles: roles
      .map((r) => ({
        name: r.name,
        label: resolveRoleLabel(r.name),
        people: r._count.users,
        rank: roleRank(r.name),
      }))
      .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)),
    accessMode: mode,
    enforcedSurfaces: mode === 'enforce' ? [...enforcedSurfaces()] : [],
    legacyOpen: policy.legacyOpen,
    policyVersion: policy.version.toString(),
    counts: {
      departments,
      people,
      peopleInDepartments: policy.membersByUser.size,
      grants: policy.grants.length,
      departmentGrants: departmentGrants.length,
      directGrants: policy.grants.length - departmentGrants.length,
      denies: policy.grants.filter((g) => g.effect === 'deny').length,
      labels: policy.labels.length,
      clearances: policy.clearances.size,
      decisions7d,
      denies7d,
    },
  });
});
