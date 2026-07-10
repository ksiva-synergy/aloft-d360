import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Aggregate audit entries from multiple lifecycle tables
    const [runs, deploys, incidents, evals] = await Promise.all([
      prisma.agent_run_log.findMany({
        select: { id: true, agentName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.deployment_record.findMany({
        select: { id: true, pipeline_id: true, status: true, promoted_by: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
      prisma.healing_incident.findMany({
        select: { id: true, agent_name: true, rule_name: true, status: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
      prisma.agent_eval_run.findMany({
        select: { id: true, eval_set_id: true, agent_version: true, pass_rate: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    ]);

    const items: { ts: string; actor: string; action: string; target: string; detail: string }[] = [];

    for (const run of runs) {
      items.push({
        ts: run.createdAt?.toISOString() ?? '',
        actor: 'system',
        action: 'run',
        target: run.agentName ?? '',
        detail: `Run ${run.id.slice(0, 8)}`,
      });
    }

    for (const dep of deploys) {
      items.push({
        ts: dep.created_at?.toISOString() ?? '',
        actor: dep.promoted_by || 'system',
        action: 'promote',
        target: `Pipeline ${dep.pipeline_id?.slice(0, 8) || 'unknown'}`,
        detail: dep.status ?? '',
      });
    }

    for (const inc of incidents) {
      items.push({
        ts: inc.created_at?.toISOString() ?? '',
        actor: 'system',
        action: 'incident',
        target: inc.agent_name ?? '',
        detail: `${inc.rule_name} → ${inc.status}`,
      });
    }

    for (const ev of evals) {
      items.push({
        ts: ev.created_at?.toISOString() ?? '',
        actor: 'system',
        action: 'eval_run',
        target: ev.agent_version || 'unknown',
        detail: `pass rate: ${((ev.pass_rate || 0) * 100).toFixed(0)}%`,
      });
    }

    // Sort by timestamp descending
    items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    return NextResponse.json({ items: items.slice(0, 50) });
  } catch (err) {
    console.error('[audit-log GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
