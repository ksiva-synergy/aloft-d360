import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAudit, serializeDecision } from '@/lib/access/admin-api';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireAccessAudit(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 200);
  const cursor = url.searchParams.get('cursor');
  const userId = url.searchParams.get('userId');

  const rows = await prisma.accessDecisionLog.findMany({
    where: {
      org_id: orgId,
      ...(userId ? { user_id: userId } : {}),
      ...(cursor ? { id: { lt: cursor } } : {}),
    },
    orderBy: [{ ts: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return ok({
    decisions: page.map(serializeDecision),
    nextCursor,
  });
});
