import { prisma } from '@/lib/db';

/**
 * When an agent's system prompt changes, auto-create a versioned snapshot
 * in the prompt_catalog with a link back to the agent.
 */
export async function snapshotAgentPrompt(opts: {
  agentId: string;
  agentName: string;
  systemPrompt: string;
  version: string;
  author?: string | null;
}) {
  const { agentId, agentName, systemPrompt, version, author } = opts;
  if (!systemPrompt || systemPrompt.trim().length === 0) return null;

  // Find the most recent prompt version linked to this agent
  const existing = await prisma.prompt_catalog.findFirst({
    select: { id: true, template: true, version: true },
    where: { linked_agent_ids: { has: agentId } },
    orderBy: { created_at: 'desc' },
  });

  // Skip if the prompt hasn't actually changed
  if (existing && existing.template === systemPrompt) {
    return existing;
  }

  const slug = `agent-${agentId.slice(0, 8)}-prompt-${Date.now().toString(36)}`;

  try {
    const newPrompt = await prisma.prompt_catalog.create({
      data: {
        name: `${agentName} — System Prompt`,
        slug,
        template: systemPrompt,
        variables: [],
        few_shot_examples: [],
        eval_criteria: [],
        version,
        parent_version_id: existing?.id || null,
        linked_agent_ids: [agentId],
        author: author || 'system',
        status: 'published',
        tags: ['auto-snapshot', 'system-prompt'],
        token_estimate: Math.ceil(systemPrompt.length / 4),
      },
    });
    return newPrompt;
  } catch (err) {
    console.error('[snapshotAgentPrompt]', err);
    return null;
  }
}
