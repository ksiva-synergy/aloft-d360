import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { agentClassFromConfig, workbenchSessionIdFromConfig } from '@/lib/construction/catalog-sync';

export const dynamic = 'force-dynamic';

/** Agents commissioned from the workbench, so they can be used, viewed, and edited later. */
export async function GET(request: NextRequest) {
  const authBlock = await guardInspectorChat(request, undefined);
  if (authBlock) return authBlock;

  try {
    const rows = await prisma.agent_catalog.findMany({
      where: { tags: { has: 'workbench' } },
      orderBy: { updated_at: 'desc' },
      take: 100,
    });

    const agents = rows.flatMap((row) => {
      if (!row.slug) return [];
      const sessionId = workbenchSessionIdFromConfig(row.config);
      return [{
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        status: row.status,
        agentClass: agentClassFromConfig(row.config),
        updatedAt: row.updated_at,
        workbenchSessionId: sessionId,
        catalogUrl: `/docs/agents/${row.slug}`,
        useUrl: `/agent-lab/agents/${row.slug}`,
        editUrl: sessionId ? `/agent-lab/workbench/${sessionId}` : null,
      }];
    });

    return NextResponse.json({ agents });
  } catch (err) {
    console.error('[agent-lab/agents GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
