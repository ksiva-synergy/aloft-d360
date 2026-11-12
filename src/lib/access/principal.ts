import { getDefaultOrg as getDefaultOrgAsync } from '@/lib/platform/agents';
import { getDefaultOrg as getDefaultOrgSync } from '@/lib/org';
import {
  clearanceForUser,
  departmentsForUser,
  loadPolicySnapshot,
} from './policy-store';
import type { AccessPrincipal } from './types';

/** True when the user holds the platform_admin app role (synced from the AAD admin group). */
export async function isPlatformAdminUser(userId: string): Promise<boolean> {
  const { loadUserRoleNames } = await import('./roles');
  return (await loadUserRoleNames(userId)).includes('platform_admin');
}

export async function principalForUser(userId: string, orgId?: string): Promise<AccessPrincipal> {
  const { loadUserRoleNames, effectiveDataRoles } = await import('./roles');
  const org = orgId ?? (await getDefaultOrgAsync()).id;
  const [policy, roleNames] = await Promise.all([loadPolicySnapshot(org), loadUserRoleNames(userId)]);
  return {
    kind: 'user',
    orgId: org,
    userId,
    departmentIds: departmentsForUser(policy, userId),
    clearance: clearanceForUser(policy, userId),
    roles: effectiveDataRoles(roleNames),
  };
}

export function systemPrincipal(
  systemKind: 'harvest' | 'knowledge-sync' | 'benchmark' | 'health',
  orgId?: string,
): AccessPrincipal {
  const org = orgId ?? getDefaultOrgSync().id;
  return { kind: 'system', orgId: org, systemKind };
}

export function userFromPrincipal(principal: AccessPrincipal): {
  userId: string;
  departmentIds: string[];
  clearance: import('./types').SensitivityLabel;
} | null {
  if (principal.kind !== 'user') return null;
  return {
    userId: principal.userId,
    departmentIds: principal.departmentIds,
    clearance: principal.clearance,
  };
}

export function enrichUserPrincipal(
  base: Extract<AccessPrincipal, { kind: 'user' }>,
  snapshot: Awaited<ReturnType<typeof loadPolicySnapshot>>,
): Extract<AccessPrincipal, { kind: 'user' }> {
  return {
    ...base,
    departmentIds: departmentsForUser(snapshot, base.userId),
    clearance: clearanceForUser(snapshot, base.userId),
  };
}

export async function listDepartmentSummaries(orgId: string) {
  const { withAccessDbRetry } = await import('./guards');
  return withAccessDbRetry(async () => {
    try {
      const { prisma } = await import('@/lib/db');
      return await prisma.accessDepartment.findMany({
        where: { org_id: orgId, archived_at: null },
        orderBy: { name: 'asc' },
        include: { _count: { select: { members: true } } },
      });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2021') {
        return [];
      }
      throw err;
    }
  });
}
