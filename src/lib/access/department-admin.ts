/**
 * Shared bits for the department APIs. A department owns data paths; groups of people are linked to it
 * and may use that data. Every change here can widen someone's access, so it bumps the policy version.
 */
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from './policy-store';
import { evictAccessModel } from './model-store';
import { isPlatformAdminRole } from './sensitive';

export async function assertActiveDepartment(orgId: string, id: string) {
  const d = await prisma.accessDataDepartment.findFirst({ where: { id, org_id: orgId, archived_at: null } });
  if (!d) throw new ApiError(404, 'Department not found');
  return d;
}

/**
 * Like rules: nobody widens their own access. If the acting admin is in a group linked to this department,
 * giving the department more data (or linking another of their groups) would give them access too.
 */
export async function assertNotWideningOwnAccess(departmentId: string, actor: { userId: string; role: string }, extraGroupId?: string) {
  if (isPlatformAdminRole(actor.role)) return;
  const links = await prisma.accessDepartmentGroup.findMany({ where: { department_id: departmentId }, select: { group_id: true } });
  const groupIds = [...new Set([...links.map((l) => l.group_id), ...(extraGroupId ? [extraGroupId] : [])])];
  if (!groupIds.length) return;
  const now = new Date();
  const mine = await prisma.accessGroupMember.findMany({
    where: { user_id: actor.userId, group_id: { in: groupIds } },
    select: { expires_at: true },
  });
  if (mine.some((m) => !m.expires_at || m.expires_at > now)) {
    throw new ApiError(403, 'You are in a group that uses this department, so this would give you access too. Ask another admin or a platform admin.');
  }
}

/** Bump the policy version and drop caches so the change applies at once. */
export async function commitDepartmentChange(orgId: string, work: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) {
  await prisma.$transaction(async (tx) => {
    await work(tx);
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);
  evictAccessModel(orgId);
}
