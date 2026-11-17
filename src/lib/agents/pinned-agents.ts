/**
 * Agents a person pinned to their sidebar. Stored per user in `user_pinned_agents`, so pins follow the
 * person across browsers and devices. At most MAX_PINNED_AGENTS each; deleted or deprecated agents drop
 * out of the list on their own (FK cascade on delete, status filter on read).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { MAX_PINNED_AGENTS, type PinnedAgent } from './pinned-agents-shared';

export class PinLimitError extends Error {
  constructor() {
    super(`You can pin up to ${MAX_PINNED_AGENTS} agents. Unpin one first.`);
  }
}

export class PinTargetError extends Error {
  constructor() {
    super('Agent not found');
  }
}

/** Same rule as the Agents list: commissioned from the Workbench, not deprecated, has a slug. */
const pinnableAgent = {
  tags: { has: 'workbench' },
  slug: { not: null },
  NOT: { status: 'deprecated' },
} satisfies Prisma.agent_catalogWhereInput;

export async function listPinnedAgents(userId: string): Promise<PinnedAgent[]> {
  const rows = await prisma.userPinnedAgent.findMany({
    where: { user_id: userId, agent: pinnableAgent },
    orderBy: [{ position: 'asc' }, { pinned_at: 'asc' }],
    take: MAX_PINNED_AGENTS,
    include: { agent: { select: { id: true, name: true, slug: true, description: true } } },
  });
  return rows.flatMap(({ agent }) =>
    agent.slug
      ? [{
          id: agent.id,
          name: agent.name,
          slug: agent.slug,
          description: agent.description,
          useUrl: `/agent-lab/agents/${agent.slug}`,
        }]
      : [],
  );
}

/** Save a new sidebar order (the client sends every pin). Ids that are not this person's pins are ignored. */
export async function reorderPinnedAgents(userId: string, order: string[]): Promise<PinnedAgent[]> {
  const ids = [...new Set(order)];
  await prisma.$transaction(
    ids.map((agentId, position) =>
      prisma.userPinnedAgent.updateMany({ where: { user_id: userId, agent_id: agentId }, data: { position } }),
    ),
  );
  return listPinnedAgents(userId);
}

/** Pin or unpin one agent for this person. Pinning when already at the limit throws PinLimitError. */
export async function setAgentPinned(userId: string, agentId: string, pinned: boolean): Promise<PinnedAgent[]> {
  if (!pinned) {
    await prisma.userPinnedAgent.deleteMany({ where: { user_id: userId, agent_id: agentId } });
    return listPinnedAgents(userId);
  }

  const agent = await prisma.agent_catalog.findFirst({ where: { id: agentId, ...pinnableAgent }, select: { id: true } });
  if (!agent) throw new PinTargetError();

  // Serializable so two quick pins from different tabs cannot both pass the limit check.
  await prisma.$transaction(
    async (tx) => {
      const existing = await tx.userPinnedAgent.findUnique({
        where: { user_id_agent_id: { user_id: userId, agent_id: agentId } },
        select: { agent_id: true },
      });
      if (existing) return;
      // Only live agents count toward the limit; pins on deprecated agents are dropped to free the slot.
      const current = await tx.userPinnedAgent.findMany({
        where: { user_id: userId },
        select: { agent_id: true, position: true, agent: { select: { status: true, slug: true, tags: true } } },
      });
      const stale = current.filter(
        (row) => row.agent.status === 'deprecated' || !row.agent.slug || !row.agent.tags.includes('workbench'),
      );
      if (stale.length > 0) {
        await tx.userPinnedAgent.deleteMany({
          where: { user_id: userId, agent_id: { in: stale.map((row) => row.agent_id) } },
        });
      }
      const live = current.length - stale.length;
      if (live >= MAX_PINNED_AGENTS) throw new PinLimitError();
      const nextPosition = current.reduce((max, row) => Math.max(max, row.position + 1), 0);
      await tx.userPinnedAgent.create({ data: { user_id: userId, agent_id: agentId, position: nextPosition } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return listPinnedAgents(userId);
}
