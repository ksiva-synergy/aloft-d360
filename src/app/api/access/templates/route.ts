import { handle, ok } from '@/lib/http';
import { DATA_ROLE_TEMPLATES, templateNeedsCatalogPath } from '@/lib/access/data-role-templates';
import { requireAccessAdmin } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  return ok({
    templates: DATA_ROLE_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      requiresDepartment: t.requiresDepartment,
      needsCatalogPath: templateNeedsCatalogPath(t),
      clearance: t.clearance,
    })),
  });
});
