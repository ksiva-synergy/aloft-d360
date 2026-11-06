import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { roleRank } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/** Workspace people for data-access pickers (departments, grants, clearances). */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();

  const [users, memberships, clearances, directGrants, userRoleRows] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: 500,
      select: { id: true, email: true, name: true, status: true },
    }),
    prisma.accessDepartmentMember.findMany({
      where: { department: { org_id: orgId, archived_at: null } },
      select: { user_id: true, department_id: true },
    }),
    prisma.accessClearance.findMany({
      where: { org_id: orgId },
      select: { user_id: true, level: true },
    }),
    prisma.accessGrant.groupBy({
      by: ['principal_id'],
      where: { org_id: orgId, principal_type: 'user' },
      _count: { _all: true },
    }),
    prisma.userRole.findMany({
      select: { userId: true, role: { select: { name: true } } },
    }),
  ]);
  const rolesByUser = new Map<string, string[]>();
  for (const r of userRoleRows) {
    rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.role.name]);
  }
  const primaryRole = (id: string) => {
    const held = rolesByUser.get(id) ?? [];
    return [...held].sort((a, b) => roleRank(b) - roleRank(a))[0] ?? 'member';
  };
  const clearanceByUser = new Map(clearances.map((c) => [c.user_id, c.level]));
  const directGrantsByUser = new Map(directGrants.map((g) => [g.principal_id, g._count._all]));

  const departmentIdsByUser = new Map<string, string[]>();
  for (const row of memberships) {
    const list = departmentIdsByUser.get(row.user_id) ?? [];
    list.push(row.department_id);
    departmentIdsByUser.set(row.user_id, list);
  }

  return ok({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      departmentIds: departmentIdsByUser.get(u.id) ?? [],
      clearance: clearanceByUser.get(u.id) ?? 'internal',
      directGrants: directGrantsByUser.get(u.id) ?? 0,
      role: primaryRole(u.id),
      platformAdmin: (rolesByUser.get(u.id) ?? []).includes('platform_admin'),
    })),
  });
});
