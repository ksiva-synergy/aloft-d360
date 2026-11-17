import { prisma } from '@/lib/db';
import { handle, ok, ApiError } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin, requireAccessClassify } from '@/lib/access/admin-api';
import { loadPolicySnapshot, clearanceForUser, departmentsForUser } from '@/lib/access/policy-store';
import { listEstateChildren, searchEstateTables, snapshotPolicyPaths } from '@/lib/access/estate-tree';
import { explainUserPath, holderNodeAccess, labelSource, pathTags } from '@/lib/access/explain';
import { effectiveDataRoles, loadUserRoleNames } from '@/lib/access/roles';
import { normalizeCatalogPath } from '@/lib/access/paths';

export const dynamic = 'force-dynamic';

/**
 * Estate tree for the Data access console.
 *
 *   ?parent=<catalog | catalog.schema>   children of that node (root when absent)
 *   ?q=<text>                            table search instead of children
 *   ?department=<id>                     add that department's grant state per node (`holder`)
 *   ?role=<name>                         add that app role's grant state per node (`holder`)
 *   ?user=<id>                           add that person's decision and explanation per node
 *   ?tags=1                              add every department and app role that touches each node
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const parentRaw = url.searchParams.get('parent');
  const q = url.searchParams.get('q');
  const departmentId = url.searchParams.get('department');
  const userId = url.searchParams.get('user');
  const roleName = url.searchParams.get('role');
  const withTags = url.searchParams.get('tags') === '1';

  if (departmentId || roleName || userId || withTags) await requireAccessAdmin(req);
  else await requireAccessClassify(req);

  const orgId = await getOrgId();
  const policy = await loadPolicySnapshot(orgId);

  const parent = parentRaw ? normalizeCatalogPath(parentRaw).path : null;
  if (parent && parent.split('.').length > 2) throw new ApiError(400, 'parent must be a catalog or schema');

  if (departmentId) {
    const dept = await prisma.accessDepartment.findFirst({
      where: { id: departmentId, org_id: orgId },
      select: { id: true },
    });
    if (!dept) throw new ApiError(404, 'Department not found');
  }

  const { nodes, truncated } = q
    ? { nodes: await searchEstateTables(orgId, q), truncated: false }
    : await listEstateChildren(orgId, parent, policy);

  const roleNames = userId ? await loadUserRoleNames(userId) : [];
  const user = userId
    ? {
        userId,
        departmentIds: departmentsForUser(policy, userId),
        clearance: clearanceForUser(policy, userId),
        roles: effectiveDataRoles(roleNames),
      }
    : null;

  const now = Date.now();
  const userAllows = user
    ? policy.grants.filter(
        (g) =>
          g.effect === 'allow' &&
          (!g.expiresAt || g.expiresAt.getTime() >= now) &&
          (g.principalType === 'user'
            ? g.principalId === user.userId
            : g.principalType === 'role'
              ? user.roles.includes(g.principalId)
              : user.departmentIds.includes(g.principalId)),
      )
    : [];

  /** This person's own grant on exactly this path, if any. */
  const directForUser = (path: string) => {
    if (!user) return null;
    const own = policy.grants.filter(
      (g) => g.principalType === 'user' && g.principalId === user.userId && g.path === path,
    );
    if (own.some((g) => g.effect === 'deny')) return 'deny' as const;
    const allow = own.find((g) => g.effect === 'allow');
    return allow ? allow.level : null;
  };

  const annotated = nodes.map((n) => {
    const label = labelSource(n.path, policy.labels);
    return {
      ...n,
      label,
      ...(departmentId ? { holder: holderNodeAccess('department', departmentId, n.path, policy.grants, now) } : {}),
      ...(roleName ? { holder: holderNodeAccess('role', roleName, n.path, policy.grants, now) } : {}),
      ...(withTags ? { tags: pathTags(n.path, policy.grants, now) } : {}),
      ...(user
        ? {
            access: explainUserPath(user, n.path, policy, now),
            userDirect: directForUser(n.path),
            accessInside: userAllows.filter((g) => g.path.startsWith(`${n.path}.`)).length,
          }
        : {}),
    };
  });

  return ok({
    parent,
    legacyOpen: policy.legacyOpen,
    truncated,
    nodes: annotated,
  });
});
