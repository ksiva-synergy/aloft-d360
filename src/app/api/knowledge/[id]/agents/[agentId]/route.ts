import { handle, ok } from '@/lib/http';
import { unlinkAgent } from '@/lib/knowledge/agents';
import { knowledgeActor } from '../../../_shared';

export const dynamic = 'force-dynamic';

/** Stop this agent searching the knowledge base. */
export const DELETE = handle<{ params: Promise<{ id: string; agentId: string }> }>(async (req, ctx) => {
  const { id, agentId } = await ctx.params;
  await unlinkAgent(await knowledgeActor(req), id, agentId);
  return ok({ unlinked: true });
});
