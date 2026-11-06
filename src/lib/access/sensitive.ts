/**
 * Only platform admins may open Confidential or Restricted data to anyone.
 *
 * Changes that can only narrow access (Block, remove a grant, lower clearance, raise a
 * label) stay open to every data access admin. Changes that can widen access to labelled
 * data need the platform_admin app role:
 *   - an allow grant on a path that is labelled (on itself or a parent)
 *   - raising someone's clearance
 *   - lowering or removing a label
 *   - adding a person who already holds clearance to a department that reaches labelled data
 */
import { ApiError } from '@/lib/http';
import { roleRank } from '@/lib/rbac';
import { labelSource, pathCovers } from './explain';
import type { PolicySnapshot, SensitivityLabel } from './types';

const RANK: Record<SensitivityLabel, number> = { internal: 0, confidential: 1, restricted: 2 };

export function isPlatformAdminRole(role: string): boolean {
  return roleRank(role) >= roleRank('platform_admin');
}

export function requirePlatformAdminFor(auth: { role: string }, action: string): void {
  if (isPlatformAdminRole(auth.role)) return;
  throw new ApiError(403, `Only a platform admin can ${action}.`, { requiredRole: 'platform_admin' });
}

/** Label that applies to a path from itself or a parent. */
export function labelOnPath(policy: PolicySnapshot, path: string): SensitivityLabel {
  return labelSource(path, policy.labels).label;
}

/** An allow grant on this path would expose labelled data (the path or a parent is labelled). */
export function allowWouldOpenLabelled(policy: PolicySnapshot, path: string): SensitivityLabel | null {
  const label = labelOnPath(policy, path);
  return label === 'internal' ? null : label;
}

export function isRaise(from: SensitivityLabel, to: SensitivityLabel): boolean {
  return RANK[to] > RANK[from];
}

/** The department has an allow grant that reaches a labelled path (above, on, or below it). */
export function departmentReachesLabelled(policy: PolicySnapshot, departmentId: string): boolean {
  const now = Date.now();
  const allows = policy.grants.filter(
    (g) =>
      g.principalType === 'department' &&
      g.principalId === departmentId &&
      g.effect === 'allow' &&
      (!g.expiresAt || g.expiresAt.getTime() >= now),
  );
  return allows.some((g) =>
    policy.labels.some((l) => pathCovers(g.path, l.path) || pathCovers(l.path, g.path)),
  );
}
