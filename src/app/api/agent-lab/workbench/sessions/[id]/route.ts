import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { constructionStateSchema, type ConstructionState } from '@/lib/construction/constructionState';
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

    let constructionState: ConstructionState | null = null;
    if (data.construction_state !== null && data.construction_state !== undefined) {
      const parsed = constructionStateSchema.safeParse(data.construction_state);
      if (parsed.success) {
        constructionState = parsed.data;
      } else {
        console.error(`[workbench/sessions/${id} GET] construction_state parse failed`, parsed.error);
      }
    }

    const pendingReflections = process.env.MARCUS_REFLECT_ENABLED === 'true'
      ? await getPendingReflections(id)
      : [];

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
      'progress', 'parent_session_id', 'branch_point_message_idx',
      'construction_state', 'context_mode',
    ];
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    // Validate construction_state and derive write-through denormalizations
    if (updates.construction_state !== undefined) {
      const parsed = constructionStateSchema.safeParse(updates.construction_state);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid construction_state', details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      updates.construction_state = parsed.data;
      updates.modality = parsed.data.modality ?? null;
      updates.readiness = parsed.data.readiness ?? null;
    }

    // Merge last_model into the progress JSON without overwriting other progress fields
    if (typeof body.last_model === 'string' && body.last_model) {
      const existing = (updates.progress ?? body.progress) as Record<string, unknown> | null ?? {};
      updates.progress = { ...(typeof existing === 'object' && existing !== null ? existing : {}), last_model: body.last_model };
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
