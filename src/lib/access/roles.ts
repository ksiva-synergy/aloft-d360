/**
 * App roles as data access holders.
 *
 * A grant to an app role applies to everyone who holds that role, and to everyone whose
 * role ranks above it in the built-in hierarchy (readonly < member < admin). So data
 * mapped to Member is also available to Admins.
 * Custom roles only match people who hold them.
 */
import { prisma } from '@/lib/db';
import { DEFAULT_ROLE, roleRank } from '@/lib/rbac';
import { withAccessDbRetry } from './guards';

/** Built-in roles, lowest first. */
export const BUILT_IN_ROLES = ['readonly', 'member', 'admin', 'platform_admin'] as const;

/** Roles whose data grants apply to someone holding `held`. */
export function effectiveDataRoles(held: string[]): string[] {
  const top = Math.max(0, ...held.map((r) => roleRank(r)));
  const inherited = BUILT_IN_ROLES.filter((r) => {
    const rank = roleRank(r);
    return rank > 0 && rank <= top;
  });
  return [...new Set([...held, ...inherited])];
}

export async function loadUserRoleNames(userId: string): Promise<string[]> {
  const rows = await withAccessDbRetry(() =>
    prisma.userRole.findMany({
      where: { userId, user: { deletedAt: null } },
      select: { role: { select: { name: true } } },
    }),
  );
  // Matches resolvePrimaryRole: someone with no role rows is treated as a Member.
  return rows.length ? rows.map((r) => r.role.name) : [DEFAULT_ROLE];
}
