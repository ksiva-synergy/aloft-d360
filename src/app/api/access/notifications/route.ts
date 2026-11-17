import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';

export const dynamic = 'force-dynamic';

/** My access notices (newest first, last 50) and how many are unread. */
export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  const [rows, unread] = await Promise.all([
    prisma.accessNotification.findMany({ where: { user_id: auth.userId }, orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.accessNotification.count({ where: { user_id: auth.userId, read_at: null } }),
  ]);
  return ok({
    unread,
    notifications: rows.map((n) => ({ id: n.id, kind: n.kind.split(':')[0], title: n.title, body: n.body, link: n.link, createdAt: n.created_at.toISOString(), read: !!n.read_at })),
  });
});

const MarkRead = z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() });

/** Mark my notices read (some, or all). */
export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  const body = parse(MarkRead, await req.json());
  const res = await prisma.accessNotification.updateMany({
    where: { user_id: auth.userId, read_at: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { read_at: new Date() },
  });
  return ok({ marked: res.count });
});
