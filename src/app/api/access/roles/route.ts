import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.ROLE_READ);
  const roles = await prisma.role.findMany({
    orderBy: { name: 'asc' },
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
  return ok({
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map((rp) => rp.permission.key),
    })),
  });
});

const CreateRole = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(), // permission keys
});

export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.ROLE_ASSIGN);
  const body = parse(CreateRole, await req.json());

  const permKeys = body.permissions ?? [];
  const perms = await prisma.permission.findMany({ where: { key: { in: permKeys } } });
  if (perms.length !== permKeys.length) throw new ApiError(400, 'One or more permission keys are unknown');

  const role = await prisma.role.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
  });

  await writeAudit({
    actorId: auth.userId,
    action: 'role.created',
    entityType: 'role',
    entityId: role.id,
    after: { name: role.name, permissions: permKeys },
    ...clientMeta(req),
  });
  return created({ role: { id: role.id, name: role.name } });
});
