import { z } from 'zod';
import { clientMeta, handle, ok, parse } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { requirePlatformAdminForBundles } from '@/lib/sections/bundles';
import { setRolePermissions } from '@/lib/sections/role-admin';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ roleId: string }> };

const SetPermissions = z.object({
  /** Exactly these editable permissions; section access and platform-admin-only keys are not touched. */
  keys: z.array(z.string().max(80)).max(100),
});

/** Set which permissions a built-in role, custom role or bundle carries (platform admins only). */
export const PUT = handle<Ctx>(async (req, ctx) => {
  const { roleId } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePlatformAdminForBundles(auth);
  const body = parse(SetPermissions, await req.json());

  const { role, before, after } = await setRolePermissions(roleId, [...new Set(body.keys)]);

  await writeAudit({
    actorId: auth.userId,
    action: 'role.permissions.updated',
    entityType: 'role',
    entityId: role.id,
    before: { name: role.name, keys: before },
    after: { name: role.name, keys: after },
    ...clientMeta(req),
  });
  return ok({ role: { id: role.id, name: role.name, keys: after } });
});
