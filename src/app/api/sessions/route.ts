import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.SESSION_READ);

  // platform_admin may request all sessions; everyone else is always scoped to their own.
  const canReadAll = auth.permissions.has(PERMISSIONS.SESSION_READ_ALL);
  const url = new URL(req.url);
  const mine = !canReadAll || url.searchParams.get('mine') === '1';

  const sessions = await prisma.session.findMany({
    where: mine ? { userId: auth.userId } : {},
    orderBy: { startedAt: 'desc' },
    take: 100,
    select: { id: true, userId: true, title: true, type: true, status: true, startedAt: true, endedAt: true },
  });
  return ok({ sessions });
});

const CreateSession = z.object({
  title: z.string().optional(),
  type: z.string().default('chat'),
  metadata: z.record(z.unknown()).optional(),
});

export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.SESSION_WRITE);
  const body = parse(CreateSession, await req.json().catch(() => ({})));

  const session = await prisma.session.create({
    data: {
      userId: auth.userId,
      title: body.title ?? null,
      type: body.type,
      status: 'ACTIVE',
      ...(body.metadata ? { metadata: body.metadata as Prisma.InputJsonValue } : {}),
    },
    select: { id: true, title: true, type: true, status: true, startedAt: true },
  });
  return created({ session });
});
