import 'server-only';

import { prisma } from '@/lib/db';
import { runtimeBriefFromCatalog } from '@/lib/construction/catalog-sync';
import { RUNNABLE_AGENT_STATUSES } from '@/lib/flows/policy';

// The saved agents an automation can ask: entries of the agent catalog (the same ones agent chat
// runs). Deprecated agents are left out. An agent can run only if it has instructions (a system
// prompt); several catalog entries are status-only placeholders without one. Drafts with
// instructions can be tried, but a published automation needs a live, staging or preview agent that
// has instructions (policy check `agent_not_ready`).

export type CatalogAgentSummary = {
  slug: string;
  name: string;
  description: string | null;
  status: string | null;
  /** Has instructions, so it can run at all (try it, or use it in tests). */
  hasInstructions: boolean;
  /** Ready for a published automation: has instructions and is live, staging or preview. */
  runnable: boolean;
  tags: string[];
};

const ready = (status: string | null) => (RUNNABLE_AGENT_STATUSES as readonly string[]).includes(status ?? '');

export async function listCatalogAgents(): Promise<CatalogAgentSummary[]> {
  const rows = await prisma.agent_catalog.findMany({
    where: { slug: { not: null }, NOT: { status: 'deprecated' } },
    orderBy: { name: 'asc' },
    take: 300,
  });
  return rows.map((r) => {
    const hasInstructions = !!runtimeBriefFromCatalog(r);
    return {
      slug: r.slug!,
      name: r.name,
      description: r.description,
      status: r.status,
      hasInstructions,
      runnable: hasInstructions && ready(r.status),
      tags: r.tags ?? [],
    };
  });
}

/** Slug → name, status and whether it has instructions, for the policy check (PolicyContext.agents). */
export async function agentStatusMap(): Promise<Map<string, { name: string; status: string | null; hasInstructions: boolean }>> {
  const rows = await prisma.agent_catalog.findMany({ where: { slug: { not: null } }, take: 1000 });
  return new Map(rows.map((r) => [r.slug!, { name: r.name, status: r.status, hasInstructions: !!runtimeBriefFromCatalog(r) }]));
}
