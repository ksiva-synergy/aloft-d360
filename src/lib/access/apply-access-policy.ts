import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { assertNotSelfClearance } from './guards';
import { normalizeCatalogPath } from './paths';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from './policy-store';
import type { Level, SensitivityLabel } from './types';

export type AccessPolicyGrant = {
  departmentId: string;
  path: string;
  level: Level;
};

export type ApplyAccessPolicyInput = {
  orgId: string;
  actorUserId: string;
  userId: string;
  /** Desired department membership. Replaces current memberships in this org. */
  departmentIds: string[];
  clearance: SensitivityLabel;
  /** Optional new allow-grant on a department the person belongs to. */
  grant?: AccessPolicyGrant | null;
};

export type ApplyAccessPolicyResult = {
  departmentsAdded: number;
  departmentsRemoved: number;
  clearance: SensitivityLabel;
  grantCreated: boolean;
};

export async function applyAccessPolicy(input: ApplyAccessPolicyInput): Promise<ApplyAccessPolicyResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true },
  });
  if (!user) throw new ApiError(404, 'User not found');

  const wanted = [...new Set(input.departmentIds)];
  if (wanted.length) {
    const found = await prisma.accessDepartment.findMany({
      where: { id: { in: wanted }, org_id: input.orgId, archived_at: null },
      select: { id: true },
    });
    if (found.length !== wanted.length) throw new ApiError(400, 'One or more departments are not in this workspace');
  }

  let grantPath: { path: string; pathDepth: number; level: Level; departmentId: string } | null = null;
  if (input.grant?.path?.trim()) {
    if (!wanted.includes(input.grant.departmentId)) {
      throw new ApiError(400, 'A path grant must be on a department this person belongs to');
    }
    const normalized = normalizeCatalogPath(input.grant.path);
    grantPath = {
      path: normalized.path,
      pathDepth: normalized.pathDepth,
      level: input.grant.level,
      departmentId: input.grant.departmentId,
    };
  }

  const currentClearance = await prisma.accessClearance.findUnique({
    where: { org_id_user_id: { org_id: input.orgId, user_id: input.userId } },
    select: { level: true },
  });
  const previousLevel = (currentClearance?.level === 'confidential' || currentClearance?.level === 'restricted'
    ? currentClearance.level
    : 'internal') as SensitivityLabel;

  if (input.clearance !== previousLevel) {
    assertNotSelfClearance(input.actorUserId, input.userId);
  }

  let departmentsAdded = 0;
  let departmentsRemoved = 0;
  let grantCreated = false;

  await prisma.$transaction(async (tx) => {
    const current = await tx.accessDepartmentMember.findMany({
      where: { user_id: input.userId, department: { org_id: input.orgId, archived_at: null } },
      select: { department_id: true },
    });
    const currentIds = new Set(current.map((m) => m.department_id));
    const wantedSet = new Set(wanted);

    const toRemove = [...currentIds].filter((id) => !wantedSet.has(id));
    const toAdd = wanted.filter((id) => !currentIds.has(id));

    if (toRemove.length) {
      const removed = await tx.accessDepartmentMember.deleteMany({
        where: { user_id: input.userId, department_id: { in: toRemove } },
      });
      departmentsRemoved = removed.count;
    }

    for (const departmentId of toAdd) {
      await tx.accessDepartmentMember.create({
        data: {
          department_id: departmentId,
          user_id: input.userId,
          source: 'manual',
          added_by: input.actorUserId,
        },
      });
      departmentsAdded += 1;
    }

    if (input.clearance === 'internal') {
      if (currentClearance) {
        await tx.accessClearance.delete({
          where: { org_id_user_id: { org_id: input.orgId, user_id: input.userId } },
        });
      }
    } else if (input.clearance !== previousLevel || !currentClearance) {
      await tx.accessClearance.upsert({
        where: { org_id_user_id: { org_id: input.orgId, user_id: input.userId } },
        create: {
          org_id: input.orgId,
          user_id: input.userId,
          level: input.clearance,
          reason: 'Set from data access policy',
          granted_by: input.actorUserId,
        },
        update: {
          level: input.clearance,
          reason: 'Set from data access policy',
          granted_by: input.actorUserId,
        },
      });
    }

    if (grantPath) {
      const existing = await tx.accessGrant.findFirst({
        where: {
          org_id: input.orgId,
          principal_type: 'department',
          principal_id: grantPath.departmentId,
          path: grantPath.path,
          effect: 'allow',
        },
      });
      if (!existing) {
        await tx.accessGrant.create({
          data: {
            org_id: input.orgId,
            principal_type: 'department',
            principal_id: grantPath.departmentId,
            path: grantPath.path,
            path_depth: grantPath.pathDepth,
            level: grantPath.level,
            effect: 'allow',
            reason: 'Set from data access policy',
            created_by: input.actorUserId,
          },
        });
        grantCreated = true;
      }
    }

    await bumpPolicyVersionInTx(tx, input.orgId);
  });

  evictPolicySnapshot(input.orgId);

  await writeAudit({
    actorId: input.actorUserId,
    action: 'access.policy.applied',
    entityType: 'user',
    entityId: input.userId,
    after: {
      email: user.email,
      departmentIds: wanted,
      clearance: input.clearance,
      grant: grantPath
        ? { departmentId: grantPath.departmentId, path: grantPath.path, level: grantPath.level }
        : null,
      departmentsAdded,
      departmentsRemoved,
      grantCreated,
    },
  });

  return {
    departmentsAdded,
    departmentsRemoved,
    clearance: input.clearance,
    grantCreated,
  };
}
