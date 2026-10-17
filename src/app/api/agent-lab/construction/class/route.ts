import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { constructionStateSchema, type ConstructionState } from '@/lib/construction/constructionState';
import { deriveReadiness } from '@/lib/construction/readiness';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { sessionId?: string; classId?: string };
  const authBlock = await guardInspectorChat(request, body.sessionId);
  if (authBlock) return authBlock;

  if (!body.sessionId || !body.classId) {
    return NextResponse.json({ error: 'sessionId and classId required' }, { status: 400 });
  }

  const row = await prisma.workbench_sessions.findUnique({ where: { id: body.sessionId } });
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const parsed = constructionStateSchema.safeParse(row.construction_state);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid construction state' }, { status: 400 });
  }

  const next: ConstructionState = {
    ...parsed.data,
    class: {
      id: body.classId.toLowerCase(),
      source: 'chosen',
      confidence: 1,
      skillRef: null,
    },
    provenance: { ...parsed.data.provenance, 'class.id': 'user' },
    readiness: deriveReadiness({
      ...parsed.data,
      class: { id: body.classId.toLowerCase(), source: 'chosen', confidence: 1, skillRef: null },
    }),
  };

  await prisma.workbench_sessions.update({
    where: { id: body.sessionId },
    data: {
      construction_state: next as unknown as object,
      readiness: next.readiness,
    },
  });

  return NextResponse.json({ class: next.class, memory: next.memory });
}
