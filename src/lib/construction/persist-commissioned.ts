import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getDefaultOrg } from '@/lib/platform/agents';
import type { ConstructionState } from './constructionState';
import { catalogSyncFromState } from './catalog-sync';

/** Copy a commissioned construction draft onto its catalog row and platform agent. */
export async function persistCommissionedAgent(catalogId: string, state: ConstructionState): Promise<void> {
  const catalog = await prisma.agent_catalog.findUnique({ where: { id: catalogId } });
  if (!catalog) return;

  const patch = catalogSyncFromState(state, {
    name: catalog.name,
    slug: catalog.slug,
    description: catalog.description,
    tags: catalog.tags,
    config: catalog.config,
  });

  await prisma.agent_catalog.update({
    where: { id: catalog.id },
    data: {
      name: patch.name,
      description: patch.description,
      tags: patch.tags,
      tools: patch.tools as unknown as Prisma.InputJsonValue,
      config: patch.config as unknown as Prisma.InputJsonValue,
      updated_at: new Date(),
    },
  });

  const platformData = {
    name: patch.name,
    description: patch.description,
    ...(patch.agentClass ? { agent_class: patch.agentClass } : {}),
  };

  if (patch.platformAgentId) {
    try {
      await prisma.platformAgent.update({ where: { id: patch.platformAgentId }, data: platformData });
      return;
    } catch (err) {
      console.error('[persist-commissioned] platform agent update by id failed', err);
    }
  }

  if (!patch.runtimeSlug) return;
  try {
    const org = await getDefaultOrg();
    await prisma.platformAgent.updateMany({
      where: { org_id: org.id, slug: patch.runtimeSlug },
      data: platformData,
    });
  } catch (err) {
    console.error('[persist-commissioned] platform agent update by slug failed', err);
  }
}
