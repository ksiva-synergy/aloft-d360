import { prisma } from '@/lib/db';
import { loadPolicySnapshot } from './policy-store';
import { principalForUser } from './principal';
import type { GrantPrincipalType, Level, PolicyGrant } from './types';

export interface EffectiveGrantRow {
  path: string;
  level: Level;
  effect: 'allow' | 'deny';
  via: GrantPrincipalType;
  principalId: string;
}

export interface UserEffectiveSummary {
  userId: string;
  policyVersion: string;
  legacyOpen: boolean;
  clearance: string;
  departments: Array<{ id: string; key: string; name: string }>;
  grants: EffectiveGrantRow[];
}

export interface EnrichedEffectiveGrantRow extends EffectiveGrantRow {
  viaLabel: string;
}

export interface UserEffectiveSummaryEnriched extends UserEffectiveSummary {
  grants: EnrichedEffectiveGrantRow[];
  accessMode: string;
}

export async function buildEffectiveSummaryEnriched(
  orgId: string,
  userId: string,
): Promise<UserEffectiveSummaryEnriched> {
  const { accessMode } = await import('./config');
  const summary = await buildEffectiveSummary(orgId, userId);

  const deptById = new Map(summary.departments.map((d) => [d.id, d]));
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  const personLabel = userRow?.name?.trim() || userRow?.email || userId.slice(0, 8);

  const grants: EnrichedEffectiveGrantRow[] = summary.grants.map((g) => {
    let viaLabel: string;
    if (g.via === 'department') {
      const d = deptById.get(g.principalId);
      viaLabel = d ? `Department · ${d.name}` : `Department · ${g.principalId.slice(0, 8)}…`;
    } else if (g.via === 'role') {
      viaLabel = `App role · ${g.principalId}`;
    } else {
      viaLabel = g.principalId === userId ? `Direct · ${personLabel}` : `User · ${g.principalId.slice(0, 8)}…`;
    }
    return { ...g, viaLabel };
  });

  return {
    ...summary,
    grants,
    accessMode: accessMode(),
  };
}

function grantVisibleToUser(
  grant: PolicyGrant,
  userId: string,
  departmentIds: string[],
  roles: string[],
): boolean {
  if (grant.principalType === 'user') return grant.principalId === userId;
  if (grant.principalType === 'role') return roles.includes(grant.principalId);
  return departmentIds.includes(grant.principalId);
}

export async function buildEffectiveSummary(orgId: string, userId: string): Promise<UserEffectiveSummary> {
  const snapshot = await loadPolicySnapshot(orgId);
  const principal = await principalForUser(userId, orgId);

  if (principal.kind !== 'user') {
    throw new Error('Expected user principal');
  }

  const deptRows = await prisma.accessDepartment.findMany({
    where: { id: { in: principal.departmentIds } },
    select: { id: true, key: true, name: true },
  });

  const grants: EffectiveGrantRow[] = [];
  for (const g of snapshot.grants) {
    if (!grantVisibleToUser(g, userId, principal.departmentIds, principal.roles ?? [])) continue;
    grants.push({
      path: g.path,
      level: g.level,
      effect: g.effect,
      via: g.principalType,
      principalId: g.principalId,
    });
  }
  grants.sort((a, b) => a.path.localeCompare(b.path));

  return {
    userId,
    policyVersion: snapshot.version.toString(),
    legacyOpen: snapshot.legacyOpen,
    clearance: principal.clearance,
    departments: deptRows,
    grants,
  };
}
