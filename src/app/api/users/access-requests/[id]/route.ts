import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta, ApiError } from '@/lib/http';
import { requireSection } from '@/lib/sections/server';
import { resolveAuth, requireRole } from '@/middleware/auth';
import { BUILT_IN_ROLES, isBuiltInRole } from '@/lib/sections/registry';
import { canManageRole } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const Decide = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    role: z.enum(BUILT_IN_ROLES),
  }),
  z.object({
    action: z.literal('reject'),
    reason: z.string().max(500).optional(),
  }),
]);

export const POST = handle<Ctx>(async (req, ctx) => {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.access-requests', 'manage']);
  requireRole(auth, 'platform_admin');
  const { id } = await ctx.params;
  const body = parse(Decide, await req.json());

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, status: true, deletedAt: true, roles: { select: { roleId: true, role: { select: { name: true } } } } },
  });
  if (!user || user.deletedAt) throw new ApiError(404, 'User not found');
  if (user.status !== 'PENDING_APPROVAL') {
    throw new ApiError(400, 'This person is not waiting for access approval');
  }

  if (body.action === 'reject') {
    await prisma.user.update({
      where: { id },
      data: { status: 'DEACTIVATED', isActive: false },
    });
    await writeAudit({
      actorId: auth.userId,
      action: 'user.access_rejected',
      entityType: 'user',
      entityId: id,
      before: { status: 'PENDING_APPROVAL' },
      after: { status: 'DEACTIVATED', reason: body.reason ?? null },
      ...clientMeta(req),
    });
    return ok({ status: 'DEACTIVATED' });
  }

  if (!isBuiltInRole(body.role)) throw new ApiError(400, 'Unknown role');
  if (!canManageRole(auth.role, body.role)) {
    throw new ApiError(403, `Your role cannot grant "${body.role}"`);
  }

  const role = await prisma.role.findUnique({ where: { name: body.role } });
  if (!role) throw new ApiError(400, 'Unknown role');

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.userRole.create({ data: { userId: id, roleId: role.id, assignedBy: auth.userId } }),
    prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE', isActive: true, lastSeenAt: new Date() },
    }),
  ]);

  await writeAudit({
    actorId: auth.userId,
    action: 'user.access_approved',
    entityType: 'user',
    entityId: id,
    before: { status: 'PENDING_APPROVAL' },
    after: { status: 'ACTIVE', role: body.role },
    ...clientMeta(req),
  });

  return ok({ status: 'ACTIVE', role: body.role });
});
