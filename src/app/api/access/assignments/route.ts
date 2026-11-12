import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS, canManageRole } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

const AssignBody = z.object({
  userId: z.string(),
  roleName: z.string(),
});

async function resolve(userId: string, roleName: string) {
  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }),
    prisma.role.findUnique({ where: { name: roleName }, select: { id: true, name: true } }),
  ]);
  if (!user) throw new ApiError(404, 'User not found');
  if (!role) throw new ApiError(404, 'Role not found');
  return { user, role };
}

/** No escalation: grant or revoke only roles at or below the caller's own. */
function assertCanManage(actorRole: string, roleName: string) {
  if (!canManageRole(actorRole, roleName)) throw new ApiError(403, `Your role cannot manage the "${roleName}" role`);
}

// Assign a role to a user.
export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.ROLE_ASSIGN);
  requireSection(auth, ['govern.users', 'manage']);
  const body = parse(AssignBody, await req.json());
  assertCanManage(auth.role, body.roleName);
  const { user, role } = await resolve(body.userId, body.roleName);

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id, assignedBy: auth.userId },
    update: {},
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'user.role.assigned',
    entityType: 'user',
    entityId: user.id,
    after: { role: role.name },
    ...clientMeta(req),
  });
  return created({ ok: true });
});

// Revoke a role from a user.
export const DELETE = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.ROLE_ASSIGN);
  requireSection(auth, ['govern.users', 'manage']);
  const body = parse(AssignBody, await req.json());
  assertCanManage(auth.role, body.roleName);
  const { user, role } = await resolve(body.userId, body.roleName);

  await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: role.id } });

  await writeAudit({
    actorId: auth.userId,
    action: 'user.role.revoked',
    entityType: 'user',
    entityId: user.id,
    before: { role: role.name },
    ...clientMeta(req),
  });
  return ok({ ok: true });
});
