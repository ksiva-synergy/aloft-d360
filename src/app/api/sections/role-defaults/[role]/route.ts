import { z } from 'zod';
import { ApiError, clientMeta, handle, ok, parse } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { BaseRoleSchema, BundleLevelsSchema, requirePlatformAdminForBundles } from '@/lib/sections/bundles';
import { setRoleDefaults } from '@/lib/sections/role-admin';
import { defaultLevels, roleDefaultOverridesFromKeys, type SectionLevels } from '@/lib/sections/registry';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ role: string }> };

const SetDefaults = z.object({
  /** Level per section. Sections left out go back to the shipped default. */
  levels: BundleLevelsSchema,
});

/**
 * Change what a built-in role (Read only, Member, Admin) gives on each section, for everyone who
 * has it (platform admins only). Manage on Data Estate and view-only sections is lowered to View.
 * Platform admin cannot be changed: it always has every section. Takes effect on each person's next request.
 */
export const PUT = handle<Ctx>(async (req, ctx) => {
  const { role: roleParam } = await ctx.params;
  const auth = await resolveAuth(req);
  requirePlatformAdminForBundles(auth);
  const role = BaseRoleSchema.safeParse(roleParam);
  if (!role.success) {
    throw new ApiError(roleParam === 'platform_admin' ? 400 : 404, roleParam === 'platform_admin' ? 'Platform admins always have every section.' : 'Unknown built-in role');
  }
  const body = parse(SetDefaults, await req.json());

  const { before, after } = await setRoleDefaults(role.data, body.levels as SectionLevels);

  await writeAudit({
    actorId: auth.userId,
    action: 'section_role_defaults.updated',
    entityType: 'role',
    entityId: role.data,
    before: { keys: before },
    after: { keys: after },
    ...clientMeta(req),
  });
  return ok({ role: role.data, defaults: defaultLevels(role.data, roleDefaultOverridesFromKeys(after)[role.data]) });
});
