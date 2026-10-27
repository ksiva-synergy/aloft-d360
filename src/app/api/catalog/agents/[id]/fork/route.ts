import { prisma } from '@/lib/db';
import { ApiError, clientMeta, created, handle, parse } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { catalogAgentForkSchema } from '../../schema';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// A fork is a private draft owned by the caller; owner, author and lineage never come from the body.
export const POST = handle<Ctx>(async (req, ctx) => {
  const params = await ctx.params;
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.INSPECTOR_USE);
  const original = await prisma.agent_catalog.findUnique({ where: { id: params.id } });
  if (!original) throw new ApiError(404, 'Entry not found');

  const body = parse(catalogAgentForkSchema, await req.json().catch(() => ({})));

  const data = await prisma.agent_catalog.create({
    data: {
      name: body.name || `${original.name} (fork)`,
      slug: `${original.slug}-fork-${Date.now().toString(36)}`,
      type: original.type,
      description: original.description,
      version: body.version || original.version,
      config: original.config ?? {},
      tools: original.tools ?? [],
      input_schema: original.input_schema ?? {},
      output_schema: original.output_schema ?? {},
      bus_subscriptions: original.bus_subscriptions ?? [],
      bus_publications: original.bus_publications ?? [],
      tags: original.tags ?? [],
      status: 'draft',
      author: original.author,
      parent_id: params.id,
      is_head: false,
      draft_of_id: null,
      owner_id: auth.userId,
      reviewers: [],
      policy_ids: original.policy_ids ?? [],
    },
  });

  await writeAudit({ actorId: auth.userId, action: 'catalog_agent.forked', entityType: 'agent_catalog', entityId: data.id, after: { parentId: params.id }, ...clientMeta(req) });
  return created({ item: data });
});
