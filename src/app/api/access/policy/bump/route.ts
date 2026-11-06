import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersion } from '@/lib/access/policy-store';
import { requireAccessAdmin } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

/** Manual policy-version bump (normally done inside mutating routes). */
export const POST = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const version = await bumpPolicyVersion(orgId);
  return ok({ orgId, version: version.toString() });
});
