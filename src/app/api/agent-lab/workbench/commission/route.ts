import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { constructionStateSchema } from '@/lib/construction/constructionState';
import { canCommissionAgent } from '@/lib/construction/readiness';
import { createAgent, getDefaultOrg } from '@/lib/platform/agents';
import { slugify } from '@/lib/catalog-helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { sessionId?: string };
  const authBlock = await guardInspectorChat(request, body.sessionId);
  if (authBlock) return authBlock;

  if (!body.sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const row = await prisma.workbench_sessions.findUnique({ where: { id: body.sessionId } });
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Idempotent: a second press (double click, retry after a dropped response) returns the same agent.
  if (row.saved_agent_id) {
    const existing = await prisma.agent_catalog.findUnique({
      where: { id: row.saved_agent_id },
      select: { id: true, slug: true },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        alreadyCommissioned: true,
        catalogId: existing.id,
        catalogSlug: existing.slug,
        catalogUrl: `/docs/agents/${existing.slug}`,
      });
    }
  }

  const parsed = constructionStateSchema.safeParse(row.construction_state);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid construction state' }, { status: 400 });
  }
  const state = parsed.data;

  if (!canCommissionAgent(state)) {
    return NextResponse.json(
      { error: 'Agent not ready — need name, class, and instructions (≥40 chars).' },
      { status: 400 },
    );
  }

  const session = await getServerSession(authOptions);
  const commissionedBy = session?.user?.email ?? session?.user?.id ?? 'workbench';

  const name = state.name!.trim();
  const agentClass = state.class!.id!;
  const slug = `${slugify(name)}-${Date.now().toString(36)}`;
  const firstSentence = state.prompt.instructions.trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 280);

  const catalog = await prisma.agent_catalog.create({
    data: {
      name,
      slug,
      type: 'worker',
      description: state.prompt.persona ?? firstSentence ?? `Commissioned from workbench session ${body.sessionId}`,
      version: '1.0.0',
      status: 'draft',
      tags: [agentClass, 'workbench'],
      config: {
        systemPrompt: state.prompt.instructions,
        persona: state.prompt.persona,
        agent_class: agentClass,
        datasources: state.tools.datasources,
        output: state.tools.output,
        validation: state.validation.lastTestRun,
        provenance: state.provenance,
        source: {
          workbenchSessionId: body.sessionId,
          inspectorSessionId: row.parent_session_id ?? null,
        },
      },
      tools: state.tools.actions.map((a) => a.toolId),
      author: commissionedBy,
    },
  });

  const org = await getDefaultOrg();
  const platform = await createAgent(org.id, {
    name,
    slug: `${slug}-runtime`,
    description: catalog.description ?? undefined,
    agent_class: agentClass,
    commissioned_by: commissionedBy,
    kb_namespace: state.memory.runtimeProvision?.kbNamespace ?? undefined,
    thread_policy: state.memory.runtimeProvision?.threadPolicy ?? undefined,
    retrieval_scope: state.memory.runtimeProvision?.retrievalScope ?? undefined,
  });

  await prisma.agent_catalog.update({
    where: { id: catalog.id },
    data: {
      config: {
        ...(catalog.config as Record<string, unknown>),
        platformAgentId: platform.id,
      },
    },
  });

  const commissioned = {
    ...state,
    readiness: 'commission' as const,
    memory: {
      ...state.memory,
      runtimeProvision: {
        kbNamespace: state.memory.runtimeProvision?.kbNamespace ?? `agent/${slug}`,
        exemplarSet: state.memory.runtimeProvision?.exemplarSet ?? null,
        threadPolicy: state.memory.runtimeProvision?.threadPolicy ?? 'per-user',
        retrievalScope: state.memory.runtimeProvision?.retrievalScope ?? 'org',
      },
    },
  };

  await prisma.workbench_sessions.update({
    where: { id: body.sessionId },
    data: {
      saved_agent_id: catalog.id,
      construction_state: commissioned as unknown as object,
      readiness: 'commission',
    },
  });

  return NextResponse.json({
    ok: true,
    catalogId: catalog.id,
    catalogSlug: catalog.slug,
    catalogUrl: `/docs/agents/${catalog.slug}`,
    platformAgentId: platform.id,
  });
}
