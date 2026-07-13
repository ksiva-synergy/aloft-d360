import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS, resolveRoleLabel } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const userSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  authProvider: true,
  aadObjectId: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: { select: { name: true } } } },
} as const;

type UserRow = {
  roles: { role: { name: string } }[];
  [key: string]: unknown;
};

const ROLE_PRECEDENCE_ORDER = ['platform_admin', 'admin', 'member', 'readonly'];

/** Shape a user DB row (with roles) into the API response object. */
function formatUser(user: UserRow) {
  const names = user.roles.map((r) => r.role.name);
  const primaryRole = ROLE_PRECEDENCE_ORDER.find((r) => names.includes(r)) ?? names[0] ?? 'readonly';
  return {
    ...user,
    primaryRole,
    roleLabel: resolveRoleLabel(primaryRole),
  };
}

export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.USER_READ);
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: userSelect,
  });
  return ok({ users: users.map(formatUser) });
});

const CreateUser = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8).optional(), // omit for AAD-only accounts
  roles: z.array(z.string()).optional(), // role names; defaults to ["readonly"]
});

export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.USER_CREATE);
  const body = parse(CreateUser, await req.json());

  const roleNames = body.roles?.length ? body.roles : ['readonly'];
  const roles = await prisma.role.findMany({ where: { name: { in: roleNames } } });
  if (roles.length !== roleNames.length) throw new ApiError(400, 'One or more role names are unknown');

  const user = await prisma.user.create({
    data: {
      email: body.email.toLowerCase(),
      name: body.name ?? null,
      authProvider: 'credentials',
      passwordHash: body.password ? await bcrypt.hash(body.password, 12) : null,
      status: 'ACTIVE',
      isActive: true,
      emailVerified: false,
      roles: { create: roles.map((r) => ({ roleId: r.id, assignedBy: auth.userId })) },
    },
    select: userSelect,
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'user.created',
    entityType: 'user',
    entityId: user.id,
    after: { email: user.email, roles: roleNames },
    ...clientMeta(req),
  });
  return created({ user: formatUser(user) });
});
