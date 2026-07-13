import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, ApiError } from '@/lib/http';
import { resolveAuth, requirePermission, requireOwnerOrPermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export const GET = handle<Ctx>(async (req, { params }) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.SESSION_READ);
  // Verify ownership before returning actions: platform_admin may view any session's actions.
  const session = await prisma.session.findUnique({ where: { id: params.id }, select: { userId: true } });
  if (!session) throw new ApiError(404, 'Session not found');
  requireOwnerOrPermission(auth, session.userId, PERMISSIONS.SESSION_READ_ALL);
  const actions = await prisma.action.findMany({
    where: { sessionId: params.id },
    orderBy: { sequence: 'asc' },
    select: { id: true, type: true, name: true, status: true, sequence: true, durationMs: true, startedAt: true, completedAt: true },
  });
  return ok({ actions });
});

const CreateAction = z.object({
  type: z.string(),
  name: z.string(),
  parentActionId: z.string().uuid().optional(),
  sequence: z.number().int().optional(),
  input: z.unknown().optional(),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'SKIPPED']).optional(),
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.SESSION_WRITE);
  const body = parse(CreateAction, await req.json());

  const session = await prisma.session.findUnique({ where: { id: params.id }, select: { id: true, userId: true } });
  if (!session) throw new ApiError(404, 'Session not found');
  // Only the session owner (or platform_admin) may append actions to a session.
  requireOwnerOrPermission(auth, session.userId, PERMISSIONS.SESSION_READ_ALL);

  const action = await prisma.action.create({
    data: {
      sessionId: params.id,
      userId: auth.userId,
      parentActionId: body.parentActionId ?? null,
      type: body.type,
      name: body.name,
      status: body.status ?? 'PENDING',
      sequence: body.sequence ?? 0,
      ...(body.input !== undefined && body.input !== null ? { input: body.input as Prisma.InputJsonValue } : {}),
    },
    select: { id: true, type: true, name: true, status: true, sequence: true },
  });
  return created({ action });
});
