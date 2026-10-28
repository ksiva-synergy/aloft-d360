import { handle, ok } from '@/lib/http';
import { listCatalogAgents, type CatalogAgentSummary } from '@/lib/agents/catalog';
import { linkAgent, listAgentLinks } from '@/lib/knowledge/agents';
import { knowledgeActor } from '../../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * The saved agents that use this knowledge base, and the agents it could be given to (those with
 * instructions). An agent searches it only for people who may see it.
 */
export const GET = handle<Ctx>(async (req, ctx) => {
  const links = await listAgentLinks(await knowledgeActor(req), (await ctx.params).id);
  const agents = (await listCatalogAgents().catch((): CatalogAgentSummary[] => [])).filter((a) => a.hasInstructions).map((a) => ({ slug: a.slug, name: a.name, status: a.status, description: a.description }));
  return ok({ links, agents });
});

/** `{ agentSlug }` — let this agent search the knowledge base. */
export const POST = handle<Ctx>(async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return ok({ link: await linkAgent(await knowledgeActor(req), (await ctx.params).id, body.agentSlug) }, 201);
});
