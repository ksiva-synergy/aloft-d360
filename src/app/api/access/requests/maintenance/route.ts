import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { requirePlatformAdminFor } from '@/lib/access/sensitive';
import { runMaintenance } from '@/lib/access/request-maintenance';

export const dynamic = 'force-dynamic';

/** "Run checks now": escalate, expire, warn about ending access, record ended access. Platform admin. */
export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  requirePlatformAdminFor(auth, 'run the access request checks');
  const orgId = await getOrgId();
  return ok({ done: await runMaintenance(orgId) });
});
