import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { buildEffectiveSummary } from '@/lib/access/effective-summary';
import { resolveAuth } from '@/middleware/auth';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  const orgId = await getOrgId();
  const summary = await buildEffectiveSummary(orgId, auth.userId);
  return ok({ summary });
});
