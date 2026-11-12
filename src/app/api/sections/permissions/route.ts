import { handle, ok } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { PERMISSION_CATALOG, PERMISSION_GROUP_LABEL } from '@/lib/permission-catalog';
import { listRolePermissions } from '@/lib/sections/role-admin';
import { requireSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

/**
 * Users → Permissions: every permission (plain words, whether code checks it today) and which roles
 * carry it. Platform admin is left out: it always has every permission. Editing is platform-admin only.
 */
export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  requireSection(auth, ['govern.users', 'view']);
  return ok({
    canEdit: auth.role === 'platform_admin',
    groups: PERMISSION_GROUP_LABEL,
    permissions: PERMISSION_CATALOG,
    roles: await listRolePermissions(),
  });
});
