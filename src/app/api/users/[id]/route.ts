import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta, ApiError } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS, canManageRole, resolveRoleLabel } from '@/lib/rbac';
import { releasedIdentityData } from '@/lib/users/release-identity';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const userSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  authProvider: true,
  aadObjectId: true,
  aadTenantId: true,
  emailVerified: true,
  lastLoginAt: true,
  createdAt: true,
  deletedAt: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
} as const;

type UserRow = {
  roles: { role: { id: string; name: string } }[];
  [key: string]: unknown;
};

const ROLE_PRECEDENCE_ORDER = ['platform_admin', 'admin', 'member', 'readonly'];

function formatUser(user: UserRow) {
  const names = user.roles.map((r) => r.role.name);
  const primaryRole = ROLE_PRECEDENCE_ORDER.find((r) => names.includes(r)) ?? names[0] ?? 'readonly';
  return {
    ...user,
    primaryRole,
    roleLabel: resolveRoleLabel(primaryRole),
  };
}

export const GET = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.USER_READ);
  const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!user) throw new ApiError(404, 'User not found');
  return ok({ user: formatUser(user) });
});

const UpdateUser = z.object({
  name: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INVITED', 'DEACTIVATED']).optional(),
  role: z.string().optional(),
});

export const PATCH = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.USER_UPDATE);
  const body = parse(UpdateUser, await req.json());

  const before = await prisma.user.findUnique({ where: { id }, select: { name: true, status: true, isActive: true } });
  if (!before) throw new ApiError(404, 'User not found');

  // Role change — requires role:assign permission in addition to user:update
  if (body.role !== undefined) {
    requirePermission(auth, PERMISSIONS.ROLE_ASSIGN);

    const newRole = await prisma.role.findUnique({ where: { name: body.role }, select: { id: true, name: true } });
    if (!newRole) throw new ApiError(400, `Unknown role: ${body.role}`);

    // No escalation: the caller can neither grant a role above their own nor re-role someone who outranks them.
    const current = await prisma.userRole.findMany({ where: { userId: id }, select: { role: { select: { name: true } } } });
    const blocked = [newRole.name, ...current.map((r) => r.role.name)].find((r) => !canManageRole(auth.role, r));
    if (blocked) throw new ApiError(403, `Your role cannot manage the "${blocked}" role`);

    // Revoke all current roles, assign the new one
    await prisma.userRole.deleteMany({ where: { userId: id } });
    await prisma.userRole.create({ data: { userId: id, roleId: newRole.id, assignedBy: auth.userId } });

    await writeAudit({
      actorId: auth.userId,
      action: 'user.role.changed',
      entityType: 'user',
      entityId: id,
      after: { role: body.role },
      ...clientMeta(req),
    });
  }

  // Profile / status update (only if name or status is present)
  if (body.name !== undefined || body.status !== undefined) {
    await prisma.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.status !== undefined ? { status: body.status, isActive: body.status === 'ACTIVE' } : {}),
      },
    });

    await writeAudit({
      actorId: auth.userId,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      before,
      after: { name: body.name, status: body.status },
      ...clientMeta(req),
    });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: userSelect });
  return ok({ user: formatUser(user) });
});

// Hide the user and free the email plus Microsoft id so the address can be invited
// as a new account. The row stays; sessions and audit history point at it.
export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.USER_DELETE);
  if (id === auth.userId) throw new ApiError(400, 'You cannot delete your own account');

  const before = await prisma.user.findUnique({
    where: { id },
    select: { email: true, status: true, deletedAt: true, roles: { select: { role: { select: { name: true } } } } },
  });
  if (!before) throw new ApiError(404, 'User not found');

  const blocked = before.roles.map((r) => r.role.name).find((role) => !canManageRole(auth.role, role));
  if (blocked) throw new ApiError(403, `Your role cannot manage the "${blocked}" role`);

  await prisma.user.update({
    where: { id },
    data: releasedIdentityData(id),
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'user.deleted',
    entityType: 'user',
    entityId: id,
    before: { email: before.email, status: before.status, deletedAt: before.deletedAt },
    after: { status: 'DEACTIVATED', emailReleased: true },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});
