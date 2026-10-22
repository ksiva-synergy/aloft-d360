import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAgentOpsAuth, assertSessionReadable } from '@/lib/agent-ops/access';
import { buildSessionCockpit } from '@/lib/agent-ops/session-cockpit';
import type { WorkbenchMessage } from '@/components/agent-lab/workbench/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await getAgentOpsAuth();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  const { sessionId } = await params;
  const access = await assertSessionReadable(sessionId, auth.userId, auth.canReadAllSessions);
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: access.status });

  const session = await prisma.workbench_sessions.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      surface: true,
      context_mode: true,
      messages: true,
      user_id: true,
      updated_at: true,
      created_at: true,
    },
  });
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [invocations, costRows, banditRows, turnRows, loopRows] = await Promise.all([
    prisma.tool_invocation_log.findMany({
      where: { session_id: sessionId },
      orderBy: [{ created_at: 'asc' }],
    }),
    prisma.agent_cost_log.findMany({
      where: { run_id: sessionId },
      orderBy: { created_at: 'asc' },
    }),
    prisma.bandit_observations.findMany({
      where: {
        OR: [
          { source_run_id: sessionId },
          { source_run_id: { startsWith: `${sessionId}_` } },
        ],
      },
      orderBy: { scored_at: 'desc' },
      take: 20,
    }),
    // Server turn/loop metrics are optional extras. async wrappers so a missing table OR a stale
    // Prisma client (model undefined → synchronous TypeError) degrades to "no data", never a 500.
    (async () => prisma.agent_turn_log.findMany({ where: { session_id: sessionId }, orderBy: { started_at: 'asc' } }))().catch(
      (e) => {
        console.warn('[runs] agent_turn_log unavailable:', e instanceof Error ? e.message : e);
        return [];
      },
    ),
    (async () =>
      prisma.agent_loop_log.findMany({ where: { session_id: sessionId }, orderBy: [{ turn_id: 'asc' }, { loop: 'asc' }] }))().catch(
      (e) => {
        console.warn('[runs] agent_loop_log unavailable:', e instanceof Error ? e.message : e);
        return [];
      },
    ),
  ]);

  const messages = (session.messages ?? []) as unknown as WorkbenchMessage[];
  const cockpit = buildSessionCockpit({
    messages,
    invocations,
    costRows,
    banditRows,
    turnRows,
    loopRows,
  });

  const openPath =
    session.surface === 'inspector'
      ? `/inspector/${sessionId}`
      : `/agent-lab/workbench/${sessionId}`;

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      surface: session.surface,
      contextMode: session.context_mode,
      updatedAt: session.updated_at?.toISOString(),
      createdAt: session.created_at?.toISOString(),
      messages,
    },
    cockpit,
    invocations: invocations.map((i) => ({
      id: i.id,
      loop: i.loop,
      toolName: i.tool_name,
      status: i.status,
      durationMs: i.duration_ms,
      error: i.error,
      input: i.input,
      output: i.output,
      model: i.model,
      createdAt: i.created_at.toISOString(),
    })),
    loops: cockpit.loops,
    links: {
      foerTrace: `/agent-lab/memory/ops?session=${sessionId}`,
      inspector: `/inspector/${sessionId}`,
      workbench: `/agent-lab/workbench/${sessionId}`,
      open: openPath,
      performanceLab: '/performance-lab',
    },
  });
}
