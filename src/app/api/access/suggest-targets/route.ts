import { z } from 'zod';
import { handle, ok, parse } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { resolveAuth } from '@/middleware/auth';
import { suggestRequestTargets } from '@/lib/access/suggest-request-targets';

export const dynamic = 'force-dynamic';

const Body = z.object({
  purpose: z.string().trim().min(4).max(2000),
  context: z.string().trim().max(800).optional(),
  anchorPath: z.string().trim().max(300).optional(),
  queryPaths: z.array(z.string().trim().max(300)).max(12).optional(),
  expandDiscovery: z.boolean().optional(),
});

/** Tables that may match what the person described (hybrid search + re-rank). Not a grant. */
export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  const orgId = await getOrgId();
  const body = parse(Body, await req.json());
  const result = await suggestRequestTargets(orgId, {
    purpose: body.purpose,
    context: body.context,
    anchorPath: body.anchorPath,
    requesterId: auth.userId,
    queryPaths: body.queryPaths,
    expandDiscovery: body.expandDiscovery,
  });
  return ok(result);
});
