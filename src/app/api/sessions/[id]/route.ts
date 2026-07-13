import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta, ApiError } from '@/lib/http';
import { resolveAuth, requirePermission, requireOwnerOrPermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

const TERMINAL = ['COMPLETED', 'FAILED', 'ABORTED'] as const;

export const GET = handle<Ctx>(async (req, { params }) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.SESSION_READ);
  const session = await prisma.session.findUnique({
    where: { id: params.id },
    include: {
      actions: { orderBy: { sequence: 'asc' }, select: { id: true, type: true, name: true, status: true, sequence: true } },
    },
  });
  if (!session) throw new ApiError(404, 'Session not found');
  // Ownership check: non-platform_admin users may only view their own sessions.
  requireOwnerOrPermission(auth, session.userId, PERMISSIONS.SESSION_READ_ALL);
  return ok({ session });
});

const UpdateSession = z.object({
  title: z.string().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'FAILED', 'ABORTED']).optional(),
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.SESSION_WRITE);

  // Verify ownership before mutating: platform_admin may mutate any session.
  const existing = await prisma.session.findUnique({ where: { id: params.id }, select: { userId: true } });
  if (!existing) throw new ApiError(404, 'Session not found');
  requireOwnerOrPermission(auth, existing.userId, PERMISSIONS.SESSION_READ_ALL);

  const body = parse(UpdateSession, await req.json());
  const isTerminal = body.status ? (TERMINAL as readonly string[]).includes(body.status) : false;
  const session = await prisma.session.update({
    where: { id: params.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      // Terminal status auto-stamps endedAt.
      ...(isTerminal ? { endedAt: new Date() } : {}),
    },
    select: { id: true, title: true, status: true, endedAt: true },
  });
  return ok({ session });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.SESSION_WRITE);

  // Verify ownership before deleting: platform_admin may delete any session.
  const existing = await prisma.session.findUnique({ where: { id: params.id }, select: { userId: true } });
  if (!existing) throw new ApiError(404, 'Session not found');
  requireOwnerOrPermission(auth, existing.userId, PERMISSIONS.SESSION_READ_ALL);

  await prisma.session.delete({ where: { id: params.id } });
  await writeAudit({
    actorId: auth.userId,
    action: 'session.deleted',
    entityType: 'session',
    entityId: params.id,
    ...clientMeta(req),
  });
  return ok({ ok: true });
});
