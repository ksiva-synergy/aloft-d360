import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { guardSessionRead } from '@/lib/inspector/session-auth';
import { loadSessionKnowledge } from '@/lib/inspector/session-knowledge-store';
import { constructionStateSchema } from '@/lib/construction/constructionState';
import { getDefaultOrg } from '@/lib/platform/agents';

export const dynamic = 'force-dynamic';

const MAX_SEEDED_SOURCES = 8;

/**
 * Inspector → Agent Lab handoff. Creates a workbench session whose draft already
 * carries the tables the Inspector session confirmed, linked back to it via
 * parent_session_id. Returns the first message the workbench should send.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { inspectorSessionId?: string; mission?: string };
  const mission = body.mission?.trim().slice(0, 2000) ?? '';
  if (!mission) return NextResponse.json({ error: 'mission required' }, { status: 400 });

  const inspectorSessionId = body.inspectorSessionId?.trim() || null;
  if (inspectorSessionId) {
    // Reading another user's Inspector context must never be served.
    const block = await guardSessionRead(request, inspectorSessionId, { route: '/api/agent-lab/workbench/handoff' });
    if (block) return block;
  }

  const knowledge = inspectorSessionId ? await loadSessionKnowledge(inspectorSessionId) : null;
  const schemaPaths = knowledge?.schemaPaths.slice(0, MAX_SEEDED_SOURCES) ?? [];

  const org = await getDefaultOrg();
  const state = constructionStateSchema.parse({
    modality: 'nl',
    memory: { buildContext: { orgId: org.id } },
    tools: { datasources: schemaPaths.map((ref) => ({ kind: 'databricks', ref, scope: null })) },
    provenance: schemaPaths.length > 0 ? { 'tools.datasources': 'template' } : {},
  });

  const created = await prisma.workbench_sessions.create({
    data: {
      user_id: session.user.id,
      title: mission.slice(0, 80),
      surface: 'workbench',
      messages: [],
      artifact_type: 'agent',
      message_count: 0,
      parent_session_id: inspectorSessionId,
      construction_state: state as unknown as Prisma.InputJsonValue,
      modality: state.modality,
      readiness: state.readiness,
    },
    select: { id: true },
  });

  const contextLines: string[] = [];
  if (schemaPaths.length > 0) contextLines.push(`Tables I already confirmed in Inspector: ${schemaPaths.join(', ')}`);
  const summary = knowledge?.summaries?.narrative ?? knowledge?.summaries?.template;
  if (summary?.trim()) contextLines.push(`What I explored: ${summary.trim().slice(0, 600)}`);
  const seedMessage = contextLines.length > 0
    ? `${mission}\n\nContext from my Inspector session:\n${contextLines.map((l) => `- ${l}`).join('\n')}`
    : mission;

  return NextResponse.json({ sessionId: created.id, seedMessage, seededSources: schemaPaths.length }, { status: 201 });
}
