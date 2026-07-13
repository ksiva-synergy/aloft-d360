import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta, ApiError } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS, resolveRoleLabel } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

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

export const GET = handle<Ctx>(async (req, { params }) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.USER_READ);
  const user = await prisma.user.findUnique({ where: { id: params.id }, select: userSelect });
  if (!user) throw new ApiError(404, 'User not found');
  return ok({ user: formatUser(user) });
});

const UpdateUser = z.object({
  name: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INVITED', 'DEACTIVATED']).optional(),
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.USER_UPDATE);
  const body = parse(UpdateUser, await req.json());

  const before = await prisma.user.findUnique({ where: { id: params.id }, select: { name: true, status: true, isActive: true } });
  if (!before) throw new ApiError(404, 'User not found');

  const user = await prisma.user.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.status !== undefined ? { status: body.status, isActive: body.status === 'ACTIVE' } : {}),
    },
    select: userSelect,
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'user.updated',
    entityType: 'user',
    entityId: user.id,
    before,
    after: { name: user.name, status: user.status },
    ...clientMeta(req),
  });
  return ok({ user: formatUser(user) });
});

// Soft delete — never hard-delete a user row (preserves audit/session FKs).
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.USER_DELETE);
  if (params.id === auth.userId) throw new ApiError(400, 'You cannot delete your own account');

  const before = await prisma.user.findUnique({ where: { id: params.id }, select: { status: true, deletedAt: true } });
  if (!before) throw new ApiError(404, 'User not found');

  await prisma.user.update({
    where: { id: params.id },
    data: { status: 'DEACTIVATED', isActive: false, deletedAt: new Date() },
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'user.deleted',
    entityType: 'user',
    entityId: params.id,
    before,
    after: { status: 'DEACTIVATED', softDeleted: true },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});
