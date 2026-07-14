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

const DAY_MS = 86_400_000;

/** Collapse a Prisma groupBy result into a userId → count map (skips null keys). */
function toCountMap(rows: Array<{ _count: { _all: number } }>, key: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const id = (r as Record<string, unknown>)[key];
    if (typeof id === 'string' && id) m.set(id, r._count._all);
  }
  return m;
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

  // Per-user engagement metrics — aggregated in a handful of groupBy queries
  // rather than one query per user (avoids N+1 over the whole member list).
  const now = Date.now();
  const since7d = new Date(now - 7 * DAY_MS);
  const since30d = new Date(now - 30 * DAY_MS);

  const [logins7d, logins30d, sessions7d, sessions30d, inspectorChats, memoryContribs] = await Promise.all([
    // Successful sign-ins (auth logins) — the "did they log in" signal.
    prisma.loginEvent.groupBy({
      by: ['userId'],
      where: { success: true, createdAt: { gte: since7d } },
      _count: { _all: true },
    }),
    prisma.loginEvent.groupBy({
      by: ['userId'],
      where: { success: true, createdAt: { gte: since30d } },
      _count: { _all: true },
    }),
    // Workbench/inspector usage sessions — only created when a user actively works.
    prisma.workbench_sessions.groupBy({
      by: ['user_id'],
      where: { created_at: { gte: since7d } },
      _count: { _all: true },
    }),
    prisma.workbench_sessions.groupBy({
      by: ['user_id'],
      where: { created_at: { gte: since30d } },
      _count: { _all: true },
    }),
    prisma.workbench_sessions.groupBy({
      by: ['user_id'],
      where: { surface: 'inspector' },
      _count: { _all: true },
    }),
    prisma.platformMemoryContribution.groupBy({
      by: ['userId'],
      _count: { _all: true },
    }),
  ]);

  const l7 = toCountMap(logins7d, 'userId');
  const l30 = toCountMap(logins30d, 'userId');
  const s7 = toCountMap(sessions7d, 'user_id');
  const s30 = toCountMap(sessions30d, 'user_id');
  const insp = toCountMap(inspectorChats, 'user_id');
  const mem = toCountMap(memoryContribs, 'userId');

  const shaped = users.map((u) => ({
    ...formatUser(u),
    logins7d: l7.get(u.id) ?? 0,
    logins30d: l30.get(u.id) ?? 0,
    sessions7d: s7.get(u.id) ?? 0,
    sessions30d: s30.get(u.id) ?? 0,
    inspectorChats: insp.get(u.id) ?? 0,
    memoriesContributed: mem.get(u.id) ?? 0,
  }));

  return ok({ users: shaped });
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
