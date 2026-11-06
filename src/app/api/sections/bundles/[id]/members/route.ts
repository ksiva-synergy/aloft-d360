import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError, clientMeta, handle, ok, parse } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { assignCustomRole, getBundleRole, requirePlatformAdminForBundles } from '@/lib/sections/bundles';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const SetMembers = z.object({ userIds: z.array(z.string().min(1)).max(500) });

/**
 * Set exactly who has a bundle or custom role (platform admins only). Giving someone a custom role
 * replaces their built-in role with its base and drops any other custom role; taking it away leaves
 * them on the base role. Takes effect on each person's next request.
 */
export const PUT = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePlatformAdminForBundles(auth);
  const role = await getBundleRole(id);
  const body = parse(SetMembers, await req.json());
  const wanted = [...new Set(body.userIds)];

  if (wanted.length) {
    const found = await prisma.user.count({ where: { id: { in: wanted }, deletedAt: null } });
    if (found !== wanted.length) throw new ApiError(400, 'One or more people were not found');
  }

  const current = (await prisma.userRole.findMany({ where: { roleId: id }, select: { userId: true } })).map((r) => r.userId);
  const add = wanted.filter((u) => !current.includes(u));
  const remove = current.filter((u) => !wanted.includes(u));

  await prisma.$transaction(async (tx) => {
    if (remove.length) await tx.userRole.deleteMany({ where: { roleId: id, userId: { in: remove } } });
    if (role.kind === 'role') {
      for (const userId of add) await assignCustomRole(tx, userId, { id, base: role.base! }, auth.userId);
    } else if (add.length) {
      await tx.userRole.createMany({ data: add.map((userId) => ({ userId, roleId: id, assignedBy: auth.userId })), skipDuplicates: true });
    }
  });

  if (add.length || remove.length) {
    await writeAudit({
      actorId: auth.userId,
      action: role.kind === 'role' ? 'section_role.members_changed' : 'section_bundle.members_changed',
      entityType: 'role',
      entityId: id,
      after: { [role.kind]: role.name, added: add, removed: remove },
      ...clientMeta(req),
    });
  }
  return ok({ added: add.length, removed: remove.length });
});
