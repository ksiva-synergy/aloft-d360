import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAgentOpsAuth } from '@/lib/agent-ops/access';
import type { RunListItem } from '@/lib/agent-ops/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await getAgentOpsAuth();
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  const surface = request.nextUrl.searchParams.get('surface');
  const statusFilter = request.nextUrl.searchParams.get('status');
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10));
  const scopeAll = auth.canReadAllSessions && request.nextUrl.searchParams.get('scope') === 'all';

  const sessions = await prisma.workbench_sessions.findMany({
    where: {
      ...(scopeAll ? {} : { user_id: auth.userId }),
      ...(surface === 'inspector' ? { surface: 'inspector' } : surface === 'workbench' ? { OR: [{ surface: 'workbench' }, { surface: null }] } : {}),
    },
    orderBy: { updated_at: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      surface: true,
      updated_at: true,
      messages: true,
      last_message: true,
    },
  });

  const sessionIds = sessions.map((s) => s.id);
  const errorCounts = sessionIds.length
    ? await prisma.tool_invocation_log.groupBy({
        by: ['session_id'],
        where: { session_id: { in: sessionIds }, status: 'error' },
        _count: { _all: true },
      })
    : [];
  const errorMap = Object.fromEntries(
    errorCounts.map((r) => [r.session_id, r._count._all]),
  );

  const bandits = sessionIds.length
    ? await prisma.bandit_observations.findMany({
        where: { source_run_id: { in: sessionIds } },
        select: { source_run_id: true, outcome: true, model_id: true, tool_calls_error: true },
      })
    : [];
  const banditMap = Object.fromEntries(
    bandits.filter((b) => b.source_run_id).map((b) => [b.source_run_id!, b]),
  );

  let runs: RunListItem[] = sessions.map((s) => {
    const bandit = banditMap[s.id];
    const toolErrorCount = errorMap[s.id] ?? bandit?.tool_calls_error ?? 0;
    const outcome = (bandit?.outcome as RunListItem['outcome']) ?? (toolErrorCount > 0 ? 'errored' : 'unknown');
    const msgs = (s.messages ?? []) as { role?: string; content?: string }[];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const lastUserExcerpt = (lastUser?.content ?? s.last_message ?? '').slice(0, 120) || null;

    return {
      sessionId: s.id,
      title: s.title,
      surface: s.surface,
      updatedAt: s.updated_at?.toISOString() ?? new Date().toISOString(),
      model: bandit?.model_id ?? null,
      outcome,
      toolErrorCount,
      lastUserExcerpt,
      stuck: false,
    };
  });

  if (statusFilter === 'failed') {
    runs = runs.filter((r) => r.toolErrorCount > 0 || r.outcome === 'errored');
  }

  return NextResponse.json({ runs, scope: scopeAll ? 'all' : 'mine' });
}
