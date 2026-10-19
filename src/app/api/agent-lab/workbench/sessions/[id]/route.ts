import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import type { ConstructionState } from '@/lib/construction/constructionState';
import { constructionStateNeedsRepair, loadConstructionState } from '@/lib/construction/load-state';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getPendingReflections } from '@/lib/marcus/dal';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await prisma.workbench_sessions.findUnique({ where: { id } });
    if (!data) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const org = await getDefaultOrg();
    const constructionState: ConstructionState = loadConstructionState(data.construction_state, org.id);

    if (constructionStateNeedsRepair(data.construction_state)) {
      await prisma.workbench_sessions.update({
        where: { id },
        data: {
          construction_state: constructionState as object,
          readiness: constructionState.readiness,
          modality: constructionState.modality ?? null,
          updated_at: new Date(),
        },
      });
    }

    const pendingReflections = process.env.MARCUS_REFLECT_ENABLED === 'true'
      ? await getPendingReflections(id)
      : [];

    const savedAgent = data.saved_agent_id
      ? await prisma.agent_catalog.findUnique({ where: { id: data.saved_agent_id }, select: { id: true, slug: true } })
      : null;

    return NextResponse.json({
      session: {
        ...data,
        attachedTools: data.attached_tools,
        attachedSchemas: data.attached_schemas,
        attachedAgents: data.attached_agents,
        artifactType: data.artifact_type,
        artifactDraft: data.artifact_draft,
        savedAgentId: data.saved_agent_id,
        parentSessionId: data.parent_session_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        constructionState,
        commission: savedAgent
          ? { catalogId: savedAgent.id, catalogSlug: savedAgent.slug, catalogUrl: `/docs/agents/${savedAgent.slug}` }
          : null,
      },
      pendingReflections,
    });
  } catch (err) {
    console.error('[workbench/sessions/:id GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch { /* empty body is valid */ }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    const fields = [
      'title', 'messages', 'attached_tools', 'attached_schemas', 'attached_agents',
      'draft', 'saved_agent_id', 'artifact_type', 'artifact_draft', 'pinned',
      // progress handled below — must merge with DB so inspectorKnowledge is not wiped
      'parent_session_id', 'branch_point_message_idx',
      'construction_state', 'context_mode',
    ];
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    // Validate construction_state and derive write-through denormalizations
    if (updates.construction_state !== undefined) {
      const org = await getDefaultOrg();
      const parsed = loadConstructionState(updates.construction_state, org.id);
      updates.construction_state = parsed;
      updates.modality = parsed.modality ?? null;
      updates.readiness = parsed.readiness ?? null;
    }

    // Merge last_model into the progress JSON without overwriting other progress fields.
    // CRITICAL: always load progress from DB — client PATCH often sends only last_model
    // and must not wipe keys like inspectorKnowledge written by the chat route.
    if (typeof body.last_model === 'string' && body.last_model) {
      const row = await prisma.workbench_sessions.findUnique({
        where: { id },
        select: { progress: true },
      });
      const fromDb =
        row?.progress && typeof row.progress === 'object' && !Array.isArray(row.progress)
          ? (row.progress as Record<string, unknown>)
          : {};
      const fromBody =
        body.progress && typeof body.progress === 'object' && !Array.isArray(body.progress)
          ? (body.progress as Record<string, unknown>)
          : {};
      updates.progress = { ...fromDb, ...fromBody, last_model: body.last_model };
    } else if (body.progress !== undefined && typeof body.progress === 'object' && body.progress !== null) {
      // Full progress replace from client — still merge over DB so server-only keys survive
      const row = await prisma.workbench_sessions.findUnique({
        where: { id },
        select: { progress: true },
      });
      const fromDb =
        row?.progress && typeof row.progress === 'object' && !Array.isArray(row.progress)
          ? (row.progress as Record<string, unknown>)
          : {};
      updates.progress = { ...fromDb, ...(body.progress as Record<string, unknown>) };
    }

    // Compute preview fields whenever messages are updated
    if (Array.isArray(body.messages)) {
      const msgs = body.messages as Array<{ role?: string; content?: string | Array<{ type?: string; text?: string }> }>;
      updates.message_count = msgs.length;

      // Find the last user message text for the preview
      let lastUserText: string | null = null;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        if (msg.role !== 'user') continue;
        if (typeof msg.content === 'string') {
          lastUserText = msg.content;
          break;
        }
        if (Array.isArray(msg.content)) {
          const textBlock = msg.content.find(b => b.type === 'text' && b.text);
          if (textBlock?.text) { lastUserText = textBlock.text; break; }
        }
      }
      updates.last_message = lastUserText ? lastUserText.slice(0, 120) : null;
    }

    await prisma.workbench_sessions.update({ where: { id }, data: updates });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[workbench/sessions/:id PATCH] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await prisma.$transaction([
      prisma.platform_interaction_search.deleteMany({ where: { session_id: id } }),
      prisma.platform_interaction_events.deleteMany({ where: { session_id: id } }),
      prisma.workbench_sessions.delete({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[workbench/sessions/:id DELETE] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
