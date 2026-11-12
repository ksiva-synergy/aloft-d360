import { z } from 'zod';
import { prisma } from '@/lib/db';
import { runInBatches } from '@/lib/db/run-in-batches';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { canManageRole, resolveRoleLabel } from '@/lib/rbac';
import { requireSection } from '@/lib/sections/server';
import { ROLE_WITH_BASE_SELECT, isBuiltInRole, splitSectionRoles } from '@/lib/sections/registry';
import { releasedIdentityData } from '@/lib/users/release-identity';
import { writeAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth-credentials';
import { surfaceWhere } from '@/lib/sessions/surfaces';

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
  roles: ROLE_WITH_BASE_SELECT,
} as const;

type UserRow = {
  roles: { role: { id: string; name: string } }[];
  [key: string]: unknown;
};

const ROLE_PRECEDENCE_ORDER = ['platform_admin', 'admin', 'member', 'readonly'];

/** Shape a user DB row (with roles) into the API response object. Bundles are listed apart from the role. */
function formatUser(user: UserRow) {
  const names = user.roles.map((r) => r.role.name);
  const primaryRole = ROLE_PRECEDENCE_ORDER.find((r) => names.includes(r)) ?? names[0] ?? 'readonly';
  const { customRole, bundles } = splitSectionRoles(user.roles);
  return {
    ...user,
    primaryRole,
    // A custom role shows by its own name; primaryRole stays the built-in base (filters, badges, rank).
    roleLabel: customRole ? customRole.name : resolveRoleLabel(primaryRole),
    customRole,
    bundles,
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
  // The cost monitor reads names from here too.
  requireSection(auth, ['govern.users', 'view'], ['govern.cost', 'view']);
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: userSelect,
  });

  const shaped = users.map((u) => ({
    ...formatUser(u),
    logins7d: 0,
    logins30d: 0,
    sessions7d: 0,
    sessions30d: 0,
    inspectorChats: 0,
    agentChats: 0,
    memoriesContributed: 0,
  }));

  try {
    const now = Date.now();
    const since7d = new Date(now - 7 * DAY_MS);
    const since30d = new Date(now - 30 * DAY_MS);

    // Cap parallel groupBy calls — seven at once against remote RDS often triggers P1001
    // when the pool or network is already busy (same pattern as dashboard summary).
    const [logins7d, logins30d, sessions7d, sessions30d, inspectorChats, agentChats, memoryContribs] =
      await runInBatches(
        [
          () =>
            prisma.loginEvent.groupBy({
              by: ['userId'],
              where: { success: true, createdAt: { gte: since7d } },
              _count: { _all: true },
            }),
          () =>
            prisma.loginEvent.groupBy({
              by: ['userId'],
              where: { success: true, createdAt: { gte: since30d } },
              _count: { _all: true },
            }),
          () =>
            prisma.workbench_sessions.groupBy({
              by: ['user_id'],
              where: { created_at: { gte: since7d }, ...surfaceWhere('workbench') },
              _count: { _all: true },
            }),
          () =>
            prisma.workbench_sessions.groupBy({
              by: ['user_id'],
              where: { created_at: { gte: since30d }, ...surfaceWhere('workbench') },
              _count: { _all: true },
            }),
          () =>
            prisma.workbench_sessions.groupBy({
              by: ['user_id'],
              where: { surface: 'inspector' },
              _count: { _all: true },
            }),
          () =>
            prisma.workbench_sessions.groupBy({
              by: ['user_id'],
              where: surfaceWhere('agent_use'),
              _count: { _all: true },
            }),
          () =>
            prisma.platformMemoryContribution.groupBy({
              by: ['userId'],
              _count: { _all: true },
            }),
        ] as const,
        3,
      );

    const l7 = toCountMap(logins7d, 'userId');
    const l30 = toCountMap(logins30d, 'userId');
    const s7 = toCountMap(sessions7d, 'user_id');
    const s30 = toCountMap(sessions30d, 'user_id');
    const insp = toCountMap(inspectorChats, 'user_id');
    const agentChat = toCountMap(agentChats, 'user_id');
    const mem = toCountMap(memoryContribs, 'userId');

    for (let i = 0; i < shaped.length; i++) {
      const u = users[i];
      shaped[i] = {
        ...shaped[i],
        logins7d: l7.get(u.id) ?? 0,
        logins30d: l30.get(u.id) ?? 0,
        sessions7d: s7.get(u.id) ?? 0,
        sessions30d: s30.get(u.id) ?? 0,
        inspectorChats: insp.get(u.id) ?? 0,
        agentChats: agentChat.get(u.id) ?? 0,
        memoriesContributed: mem.get(u.id) ?? 0,
      };
    }
  } catch (err) {
    console.warn('[GET /api/users] activity metrics skipped:', err);
  }

  return ok({ users: shaped });
});

const CreateUser = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8).optional(),
  roles: z.array(z.string()).optional(), // built-in role names; defaults to ["readonly"]. Bundles are added in Section access.
});

export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.users', 'manage']);
  const body = parse(CreateUser, await req.json());

  const roleNames = body.roles?.length ? body.roles : ['readonly'];
  const bundle = roleNames.find((r) => !isBuiltInRole(r));
  if (bundle) throw new ApiError(400, `"${bundle}" is not a role. Add bundles in Users → Section access after the invite.`);
  const roles = await prisma.role.findMany({ where: { name: { in: roleNames } } });
  if (roles.length !== roleNames.length) throw new ApiError(400, 'One or more role names are unknown');

  const email = body.email.toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });

  if (existing && !existing.deletedAt) {
    throw new ApiError(409, 'A user with this email is already on the Users page');
  }

  const blocked = roleNames.find((role) => !canManageRole(auth.role, role));
  if (blocked) throw new ApiError(403, `Your role cannot manage the "${blocked}" role`);

  const roleLinks = roles.map((r) => ({ roleId: r.id, assignedBy: auth.userId }));

  const passwordHash = body.password ? await hashPassword(body.password) : null;
  const authProvider = passwordHash ? 'credentials' : 'aad';

  const user = await prisma.$transaction(async (tx) => {
    if (existing?.deletedAt) {
      await tx.user.update({
        where: { id: existing.id },
        data: releasedIdentityData(existing.id),
      });
    }

    return tx.user.create({
      data: {
        email,
        name: body.name ?? null,
        authProvider,
        passwordHash,
        status: 'ACTIVE',
        isActive: true,
        emailVerified: Boolean(passwordHash),
        roles: { create: roleLinks },
      },
      select: userSelect,
    });
  });

  if (existing?.deletedAt) {
    await writeAudit({
      actorId: auth.userId,
      action: 'user.identity_released',
      entityType: 'user',
      entityId: existing.id,
      after: { email, replacedBy: user.id },
      ...clientMeta(req),
    });
  }

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
