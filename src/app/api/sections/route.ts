import { handle, ok } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { SECTIONS, SECTION_GROUP_LABEL, bundleCeiling } from '@/lib/sections/registry';
import { listBundles } from '@/lib/sections/bundles';
import { loadRoleDefaultOverrides } from '@/lib/sections/role-admin';
import { requireSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

/**
 * Section access matrix: every section with what each built-in role gives today (`defaults`, which
 * includes changes made here) and the shipped defaults (`builtInDefaults`), plus every bundle.
 * Editing is platform-admin only.
 */
export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.users', 'view']);
  const [overrides, bundles] = await Promise.all([loadRoleDefaultOverrides(), listBundles()]);
  return ok({
    canEdit: auth.role === 'platform_admin',
    groups: SECTION_GROUP_LABEL,
    sections: SECTIONS.map((s) => ({
      id: s.id,
      label: s.label,
      group: s.group,
      view: s.view,
      manage: s.manage,
      defaults: {
        readonly: overrides.readonly[s.id] ?? s.defaults.readonly,
        member: overrides.member[s.id] ?? s.defaults.member,
        admin: overrides.admin[s.id] ?? s.defaults.admin,
      },
      builtInDefaults: s.defaults,
      viewOnly: Boolean(s.viewOnly),
      platformAdminActionsOnly: Boolean(s.manageIsPlatformAdminOnly),
      enforced: Boolean(s.enforced),
      bundleCeiling: bundleCeiling(s),
    })),
    /** Only the cells changed from the shipped defaults, per built-in role. */
    roleOverrides: overrides,
    bundles,
  });
});
