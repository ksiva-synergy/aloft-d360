import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { columnAccessMode } from '@/lib/access/column-guard';
import { accessMode } from '@/lib/access/config';

export const dynamic = 'force-dynamic';

function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

/**
 * Access health (E11-T3): what the column check did (enforce) or would do (shadow) in the last
 * 7, 14 or 30 days, how long it took, and normal query time for comparison.
 */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const days = [7, 14, 30].includes(Number(new URL(req.url).searchParams.get('days'))) ? Number(new URL(req.url).searchParams.get('days')) : 7;
  const since = new Date(Date.now() - days * 86_400_000);

  const [rows, toolCalls] = await Promise.all([
    prisma.accessDecisionLog.findMany({
      where: { org_id: orgId, ts: { gte: since }, column_mode: { not: null } },
      select: { reason: true, decision: true, masked_columns: true, refused_columns: true, parser_ok: true, timings: true, user_id: true },
      take: 20_000,
      orderBy: { ts: 'desc' },
    }),
    prisma.tool_invocation_log.findMany({
      where: { tool_name: 'execute_tool', created_at: { gte: since } },
      select: { duration_ms: true },
      take: 20_000,
    }),
  ]);

  const byReason: Record<string, number> = {};
  const masked = new Map<string, number>();
  const refused = new Map<string, number>();
  const checkMs: number[] = [];
  for (const r of rows) {
    byReason[r.reason ?? 'column_ok'] = (byReason[r.reason ?? 'column_ok'] ?? 0) + 1;
    for (const c of r.masked_columns) masked.set(c, (masked.get(c) ?? 0) + 1);
    for (const c of r.refused_columns) refused.set(c, (refused.get(c) ?? 0) + 1);
    const t = (r.timings as { total_ms?: number } | null)?.total_ms;
    if (typeof t === 'number') checkMs.push(t);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([column, count]) => ({ column, count }));
  const queryMs = toolCalls.map((t) => t.duration_ms);
  const checked = rows.length;

  return ok({
    days,
    modes: { access: accessMode(), columns: columnAccessMode() },
    checked,
    people: new Set(rows.map((r) => r.user_id)).size,
    outcomes: {
      ok: byReason.column_ok ?? 0,
      masked: byReason.column_masked ?? 0,
      totalsOnly: byReason.column_totals_only ?? 0,
      refused: byReason.column_refused ?? 0,
      unresolved: byReason.column_unresolved ?? 0,
    },
    parserUnsureRate: checked ? (byReason.column_unresolved ?? 0) / checked : 0,
    checkMs: { p50: pct(checkMs, 50), p95: pct(checkMs, 95) },
    queryMs: { p50: pct(queryMs, 50), p95: pct(queryMs, 95), count: queryMs.length },
    topMasked: top(masked),
    topRefused: top(refused),
    gates: {
      overheadP95Under20ms: (pct(checkMs, 95) ?? 0) < 20,
      parserUnsureUnder2Pct: checked ? (byReason.column_unresolved ?? 0) / checked < 0.02 : true,
    },
  });
});
