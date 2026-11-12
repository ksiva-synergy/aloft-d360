import { handle, ok, ApiError } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { buildEffectiveSummaryEnriched } from '@/lib/access/effective-summary';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ userId: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const { userId } = await ctx.params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw new ApiError(404, 'User not found');

  const summary = await buildEffectiveSummaryEnriched(orgId, userId);
  return ok({
    user: { id: user.id, email: user.email, name: user.name },
    summary,
  });
});
