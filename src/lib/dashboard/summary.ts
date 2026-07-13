/**
 * Server-side aggregation for the platform overview dashboard (/dashboard).
 *
 * Pulls a compact summary from each of the four core modules — Data Estate,
 * Memory (FOER), User Logins, and Inspector — in a single pass. Every section
 * is wrapped so one failing subsystem (e.g. an unconfigured org, an empty table)
 * degrades to `null` for that card instead of 500-ing the whole page.
 */
import { prisma } from '@/lib/db';
import { getDefaultOrg } from '@/lib/platform/agents';
import { computeMemoryStats } from '@/lib/foer/stats';

// ── Public types ───────────────────────────────────────────────────────────────

export interface EstateSummary {
  sources: number;
  estateTotal: number; // active objects inventoried across the estate
  harvested: number; // context objects materialised
  profiled: number;
  enriched: number;
  embedded: number;
  staleCount: number;
  queuedJobs: number;
  lastSweepAt: string | null;
}

export interface MemorySummary {
  activeMemories: number;
  coreMemories: number;
  tracedSessions: number;
  totalTraceNodes: number;
  helpfulRatio: number; // 0..1
  helpfulTotal: number;
  harmfulTotal: number;
  topicCount: number;
  injectedLast24h: number;
  phantomsBlocked7d: number;
  unprocessedSessions: number;
  lastSynthesisAt: string | null;
  injectEnabled: boolean;
  topTopics: { name: string; count: number }[];
  storeSeries: number[]; // active-count sparkline (last N days)
}

export interface LoginsSummary {
  totalUsers: number;
  activeUsers: number;
  logins24h: number;
  logins7d: number;
  failed7d: number;
  roleDistribution: { role: string; count: number }[];
  recent: {
    email: string;
    name: string | null;
    provider: string;
    success: boolean;
    at: string;
  }[];
}

export interface InspectorSummary {
  totalSessions: number;
  sessions7d: number;
  totalMessages: number;
  activeUsers: number;
  dailyCounts: number[]; // sessions/day for the last 7 days (oldest → newest)
  recent: {
    title: string;
    messageCount: number;
    at: string;
    user: string | null;
  }[];
}

export interface DashboardSummary {
  estate: EstateSummary | null;
  memory: MemorySummary | null;
  logins: LoginsSummary | null;
  inspector: InspectorSummary | null;
  generatedAt: string;
}

export interface DashboardScope {
  /** Include cross-user login/user analytics (platform_admin / user:read). */
  canReadUsers: boolean;
}

// ── Section fetchers ─────────────────────────────────────────────────────────

async function fetchEstate(orgId: string): Promise<EstateSummary | null> {
  try {
    const [objectRows, estateRows, sources, queued] = await Promise.all([
      prisma.$queryRaw<
        { harvested: number; profiled: number; enriched: number; embedded: number }[]
      >`
        SELECT
          COUNT(*)::int AS harvested,
          COUNT(CASE WHEN o.last_t1_at IS NOT NULL THEN 1 END)::int AS profiled,
          COUNT(CASE WHEN o.last_t2_at IS NOT NULL THEN 1 END)::int AS enriched,
          COUNT(CASE WHEN e.subject_id IS NOT NULL THEN 1 END)::int AS embedded
        FROM platform_context_objects o
        LEFT JOIN platform_context_embeddings e
          ON o.id = e.subject_id AND e.subject_kind = 'object' AND e.org_id = ${orgId}
        WHERE o.org_id = ${orgId} AND o.lifecycle = 'active'
      `,
      prisma.$queryRaw<{ estate_total: number; stale_count: number; last_sweep: Date | null }[]>`
        SELECT
          COUNT(*)::int AS estate_total,
          COUNT(CASE WHEN last_inventoried_at < NOW() - INTERVAL '30 days' THEN 1 END)::int AS stale_count,
          MAX(last_inventoried_at) AS last_sweep
        FROM platform_estate_objects
        WHERE org_id = ${orgId} AND lifecycle = 'active'
      `,
      prisma.platformContextSource.count({ where: { org_id: orgId } }),
      prisma.platformContextJob.count({ where: { org_id: orgId, status: 'queued' } }),
    ]);

    const o = objectRows[0];
    const es = estateRows[0];
    return {
      sources,
      estateTotal: es?.estate_total ?? 0,
      harvested: o?.harvested ?? 0,
      profiled: o?.profiled ?? 0,
      enriched: o?.enriched ?? 0,
      embedded: o?.embedded ?? 0,
      staleCount: es?.stale_count ?? 0,
      queuedJobs: queued,
      lastSweepAt: es?.last_sweep ? new Date(es.last_sweep).toISOString() : null,
    };
  } catch (err) {
    console.error('[dashboard/summary] estate section failed', err);
    return null;
  }
}

async function fetchMemory(orgId: string): Promise<MemorySummary | null> {
  try {
    const s = await computeMemoryStats(orgId);
    return {
      activeMemories: s.activeBullets,
      coreMemories: s.coreMemories,
      tracedSessions: s.tracedSessions,
      totalTraceNodes: s.totalTraceNodes,
      helpfulRatio: s.helpfulHarmfulRatio,
      helpfulTotal: s.helpfulTotal,
      harmfulTotal: s.harmfulTotal,
      topicCount: s.topicCount,
      injectedLast24h: s.injectedLast24h ?? 0,
      phantomsBlocked7d: s.phantomsBlocked7d,
      unprocessedSessions: s.unprocessedSessions,
      lastSynthesisAt: s.lastSynthesisAt,
      injectEnabled: s.flagStatus.enabled,
      topTopics: s.topics.slice(0, 4).map((t) => ({ name: t.topicName, count: t.memberCount })),
      storeSeries: s.storeSizeSeries.map((p) => p.active),
    };
  } catch (err) {
    console.error('[dashboard/summary] memory section failed', err);
    return null;
  }
}

async function fetchLogins(scope: DashboardScope): Promise<LoginsSummary | null> {
  try {
    const now = Date.now();
    const day = new Date(now - 24 * 60 * 60 * 1000);
    const week = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [totalUsers, activeUsers, logins24h, logins7d, failed7d, roleRows] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.loginEvent.count({ where: { success: true, createdAt: { gte: day } } }),
      prisma.loginEvent.count({ where: { success: true, createdAt: { gte: week } } }),
      prisma.loginEvent.count({ where: { success: false, createdAt: { gte: week } } }),
      prisma.role.findMany({
        select: { name: true, _count: { select: { users: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);

    let recent: LoginsSummary['recent'] = [];
    if (scope.canReadUsers) {
      const events = await prisma.loginEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          email: true,
          provider: true,
          success: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      });
      recent = events.map((e) => ({
        email: e.email,
        name: e.user?.name ?? null,
        provider: e.provider,
        success: e.success,
        at: e.createdAt.toISOString(),
      }));
    }

    return {
      totalUsers,
      activeUsers,
      logins24h,
      logins7d,
      failed7d,
      roleDistribution: roleRows
        .map((r) => ({ role: r.name, count: r._count.users }))
        .filter((r) => r.count > 0),
      recent,
    };
  } catch (err) {
    console.error('[dashboard/summary] logins section failed', err);
    return null;
  }
}

async function fetchInspector(scope: DashboardScope, userId: string): Promise<InspectorSummary | null> {
  try {
    const now = Date.now();
    const week = new Date(now - 7 * 24 * 60 * 60 * 1000);
    // Members only see their own inspector activity; user:read sees org-wide.
    const scopeWhere = scope.canReadUsers ? {} : { user_id: userId };
    const base = { surface: 'inspector', ...scopeWhere } as const;

    const [totalSessions, sessions7d, agg, distinctUsers, recentRows] = await Promise.all([
      prisma.workbench_sessions.count({ where: base }),
      prisma.workbench_sessions.count({ where: { ...base, created_at: { gte: week } } }),
      prisma.workbench_sessions.aggregate({ where: base, _sum: { message_count: true } }),
      prisma.workbench_sessions.groupBy({ by: ['user_id'], where: base }),
      prisma.workbench_sessions.findMany({
        where: base,
        orderBy: { updated_at: 'desc' },
        take: 5,
        select: { title: true, message_count: true, updated_at: true, user_id: true },
      }),
    ]);

    // Resolve user labels for the recent sessions (best-effort).
    const userIds = [...new Set(recentRows.map((r) => r.user_id).filter(Boolean))] as string[];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email]));

    // Sessions/day for the last 7 days.
    const recentForSeries = await prisma.workbench_sessions.findMany({
      where: { ...base, created_at: { gte: week } },
      select: { created_at: true },
    });
    const dailyCounts = Array(7).fill(0) as number[];
    for (const row of recentForSeries) {
      if (!row.created_at) continue;
      const daysAgo = Math.floor((now - row.created_at.getTime()) / (24 * 60 * 60 * 1000));
      const idx = 6 - Math.min(6, daysAgo);
      if (idx >= 0 && idx < 7) dailyCounts[idx] += 1;
    }

    return {
      totalSessions,
      sessions7d,
      totalMessages: agg._sum.message_count ?? 0,
      activeUsers: distinctUsers.length,
      dailyCounts,
      recent: recentRows.map((r) => ({
        title: r.title?.trim() || 'Untitled session',
        messageCount: r.message_count ?? 0,
        at: (r.updated_at ?? new Date(0)).toISOString(),
        user: r.user_id ? userMap.get(r.user_id) ?? null : null,
      })),
    };
  } catch (err) {
    console.error('[dashboard/summary] inspector section failed', err);
    return null;
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export async function getDashboardSummary(
  scope: DashboardScope,
  userId: string,
): Promise<DashboardSummary> {
  // Estate + memory need the org; resolve once and share (null-safe).
  let orgId: string | null = null;
  try {
    orgId = (await getDefaultOrg()).id;
  } catch (err) {
    console.error('[dashboard/summary] org resolution failed', err);
  }

  const [estate, memory, logins, inspector] = await Promise.all([
    orgId ? fetchEstate(orgId) : Promise.resolve(null),
    orgId ? fetchMemory(orgId) : Promise.resolve(null),
    fetchLogins(scope),
    fetchInspector(scope, userId),
  ]);

  return {
    estate,
    memory,
    logins,
    inspector,
    generatedAt: new Date().toISOString(),
  };
}
