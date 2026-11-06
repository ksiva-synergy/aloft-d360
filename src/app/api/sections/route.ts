import { handle, ok } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { SECTIONS, SECTION_GROUP_LABEL, bundleCeiling } from '@/lib/sections/registry';
import { listBundles } from '@/lib/sections/bundles';
import { requireSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

/** Section access matrix: every section with its role defaults, plus every bundle. Editing is platform-admin only. */
export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.users', 'view']);
  return ok({
    canEdit: auth.role === 'platform_admin',
    groups: SECTION_GROUP_LABEL,
    sections: SECTIONS.map((s) => ({
      id: s.id,
      label: s.label,
      group: s.group,
      view: s.view,
      manage: s.manage,
      defaults: s.defaults,
      viewOnly: Boolean(s.viewOnly),
      platformAdminActionsOnly: Boolean(s.manageIsPlatformAdminOnly),
      enforced: Boolean(s.enforced),
      bundleCeiling: bundleCeiling(s),
    })),
    bundles: await listBundles(),
  });
});
