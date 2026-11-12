import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { assertNotSelfClearance } from './guards';
import { normalizeCatalogPath } from './paths';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from './policy-store';
import {
  getDataRoleTemplate,
  templateNeedsCatalogPath,
  type DataRoleTemplate,
} from './data-role-templates';

export type ApplyDataRoleInput = {
  orgId: string;
  actorUserId: string;
  userId: string;
  templateKey: string;
  departmentId?: string;
  catalogPath?: string;
};

export type ApplyDataRoleResult = {
  templateKey: string;
  departmentId?: string;
  grantsCreated: number;
  clearanceSet: boolean;
  memberAdded: boolean;
};

async function assertDepartment(orgId: string, departmentId: string) {
  const row = await prisma.accessDepartment.findFirst({
    where: { id: departmentId, org_id: orgId, archived_at: null },
  });
  if (!row) throw new ApiError(404, 'Department not found');
  return row;
}

function resolveGrantPaths(template: DataRoleTemplate, catalogPath?: string): Array<{ path: string; level: string }> {
  const out: Array<{ path: string; level: string }> = [];
  for (const spec of template.grantSpecs) {
    if (spec.useCatalogPathFromRequest) {
      if (!catalogPath?.trim()) {
        throw new ApiError(400, 'This data role requires a catalog path');
      }
      const { path } = normalizeCatalogPath(catalogPath);
      out.push({ path, level: spec.level });
    } else if (spec.path) {
      const { path } = normalizeCatalogPath(spec.path);
      out.push({ path, level: spec.level });
    }
  }
  return out;
}

export async function applyDataRoleToUser(input: ApplyDataRoleInput): Promise<ApplyDataRoleResult> {
  const template = getDataRoleTemplate(input.templateKey);
  if (!template) throw new ApiError(404, 'Unknown data role template');

  if (templateNeedsCatalogPath(template) && !input.catalogPath?.trim()) {
    throw new ApiError(400, 'catalogPath is required for this data role');
  }

  if (template.requiresDepartment && !input.departmentId) {
    throw new ApiError(400, 'departmentId is required for this data role');
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true },
  });
  if (!user) throw new ApiError(404, 'User not found');

  let departmentId = input.departmentId;
  let departmentName: string | undefined;
  if (departmentId) {
    const dept = await assertDepartment(input.orgId, departmentId);
    departmentName = dept.name;
  }

  if (template.clearance) {
    assertNotSelfClearance(input.actorUserId, input.userId);
  }

  const grantPaths = resolveGrantPaths(template, input.catalogPath);
  let grantsCreated = 0;
  let memberAdded = false;
  let clearanceSet = false;

  await prisma.$transaction(async (tx) => {
    if (departmentId) {
      await tx.accessDepartmentMember.upsert({
        where: {
          department_id_user_id: { department_id: departmentId, user_id: input.userId },
        },
        create: {
          department_id: departmentId,
          user_id: input.userId,
          source: 'manual',
          added_by: input.actorUserId,
        },
        update: {},
      });
      memberAdded = true;
    }

    if (template.clearance) {
      await tx.accessClearance.upsert({
        where: { org_id_user_id: { org_id: input.orgId, user_id: input.userId } },
        create: {
          org_id: input.orgId,
          user_id: input.userId,
          level: template.clearance,
          reason: `Data role: ${template.name}`,
          granted_by: input.actorUserId,
        },
        update: {
          level: template.clearance,
          reason: `Data role: ${template.name}`,
          granted_by: input.actorUserId,
        },
      });
      clearanceSet = true;
    }

    if (departmentId) {
      for (const { path, level } of grantPaths) {
        const { pathDepth } = normalizeCatalogPath(path);
        const existing = await tx.accessGrant.findFirst({
          where: {
            org_id: input.orgId,
            principal_type: 'department',
            principal_id: departmentId,
            path,
            effect: 'allow',
          },
        });
        if (existing) continue;

        await tx.accessGrant.create({
          data: {
            org_id: input.orgId,
            principal_type: 'department',
            principal_id: departmentId,
            path,
            path_depth: pathDepth,
            level,
            effect: 'allow',
            reason: `Data role: ${template.name}`,
            created_by: input.actorUserId,
          },
        });
        grantsCreated += 1;
      }
    }

    await bumpPolicyVersionInTx(tx, input.orgId);
  });

  evictPolicySnapshot(input.orgId);

  await writeAudit({
    actorId: input.actorUserId,
    action: 'access.data_role.applied',
    entityType: 'user',
    entityId: input.userId,
    after: {
      templateKey: template.key,
      templateName: template.name,
      departmentId,
      departmentName,
      grantsCreated,
      clearance: template.clearance,
    },
  });

  return {
    templateKey: template.key,
    departmentId,
    grantsCreated,
    clearanceSet,
    memberAdded,
  };
}
