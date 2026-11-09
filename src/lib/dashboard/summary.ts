/**
 * Server-side aggregation for the platform overview dashboard (/dashboard).
 *
 * Pulls a compact summary from each of the core modules — Data Estate, pipeline Jobs,
 * Memory (FOER), User Logins, and Inspector — in a single pass. Every section
 * is wrapped so one failing subsystem (e.g. an unconfigured org, an empty table)
 * degrades to `null` for that card instead of 500-ing the whole page.
 */
import { prisma } from '@/lib/db';
import { runInBatches } from '@/lib/db/run-in-batches';
import { getDefaultOrg } from '@/lib/platform/agents';
import { computeMemoryStats } from '@/lib/foer/stats';
import { listJobKindSummaries } from '@/lib/context/reads';
import { computeJobHealth } from '@/lib/memory/jobHealth';
import { HARVEST_SCHEDULES, getNextRuns } from '@/lib/context/schedules';

const DASHBOARD_DB_CONCURRENCY = 3;
const SUMMARY_CACHE_TTL_MS = 30_000;

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

export interface JobsSummary {
  /** Per job kind, counts over the last 7 days; `lastStatus` is the most recent run ever. */
  kinds: {
    kind: string;
    lastStatus: string | null;
    lastFinishedAt: string | null;
    runs7d: number;
    succeeded7d: number;
    failed7d: number;
    running: number;
    queued: number;
    /** Live schedule missed: no finish within 1.5× its cadence (same rule as the Jobs page). */
    overdue?: boolean;
  }[];
  /** Memory background jobs with a staleness threshold (synthesize, grow_refine, reclassify). */
  memoryJobs: { jobKey: string; status: 'green' | 'amber' | 'red'; ageHours: number | null; thresholdHours: number }[];
}

export interface GovernanceSummary {
  /** Active tables whose latest description flags personal data. */
  piiTables: number;
  /** …of which nobody has confirmed or dismissed the PII flag on that version. */
  piiPending: number;
  /** Latest candidate semantic model awaiting review, if any. */
  review: { modelId: string; name: string; entities: number; dimensions: number; measures: number } | null;
}

export interface SpendSummary {
  /** USD, last 7 days. */
  last7d: number;
  /** USD, the 7 days before that. */
  prev7d: number;
  /** USD per day, oldest → newest (7 entries). */
  daily: number[];
  /** Last-7-day split, largest first. */
  byArea: { area: string; usd: number }[];
}

export interface DashboardSummary {
  estate: EstateSummary | null;
  memory: MemorySummary | null;
  logins: LoginsSummary | null;
  inspector: InspectorSummary | null;
  /** Optional so older cached payloads and test fixtures stay valid. */
  jobs?: JobsSummary | null;
  governance?: GovernanceSummary | null;
  /** Admin scope only (canReadUsers). */
  spend?: SpendSummary | null;
  generatedAt: string;
}

export interface DashboardScope {
  /** Include cross-user login/user analytics (platform_admin / user:read). */
  canReadUsers: boolean;
}

const summaryCache = new Map<string, { at: number; data: DashboardSummary }>();

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
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM platform_context_embeddings e
            WHERE e.subject_kind = 'object' AND e.subject_id = o.id AND e.embedding IS NOT NULL
          ))::int AS embedded
        FROM platform_context_objects o
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
      topTopics: s.topics.slice(0, 7).map((t) => ({ name: t.topicName, count: t.memberCount })),
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

    const [totalUsers, activeUsers, logins24h, logins7d, failed7d, roleRows] = await runInBatches(
      [
        () => prisma.user.count({ where: { deletedAt: null } }),
        () => prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        () => prisma.loginEvent.count({ where: { success: true, createdAt: { gte: day } } }),
        () => prisma.loginEvent.count({ where: { success: true, createdAt: { gte: week } } }),
        () => prisma.loginEvent.count({ where: { success: false, createdAt: { gte: week } } }),
        () =>
          prisma.role.findMany({
            select: { name: true, _count: { select: { users: true } } },
            orderBy: { name: 'asc' },
          }),
      ] as const,
      DASHBOARD_DB_CONCURRENCY,
    );

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

async function fetchJobs(orgId: string): Promise<JobsSummary | null> {
  try {
    const kinds = await listJobKindSummaries(orgId, { sinceDays: 7, detail: true, recentLimit: 1 });
    let memoryJobs: JobsSummary['memoryJobs'] = [];
    try {
      const report = await computeJobHealth(orgId);
      memoryJobs = report.jobs.map((j) => ({
        jobKey: j.jobKey,
        status: j.status,
        ageHours: j.ageHours,
        thresholdHours: j.staleThresholdHours,
      }));
    } catch (err) {
      console.error('[dashboard/summary] memory job health failed', err);
    }
    const now = Date.now();
    const cadenceByKind = new Map<string, number>();
    for (const sched of HARVEST_SCHEDULES) {
      if (sched.deployment === 'manual') continue;
      const runs = getNextRuns(sched, 2);
      if (runs.length === 2) cadenceByKind.set(sched.id.replace(/_(daily|weekly)$/, ''), runs[1].getTime() - runs[0].getTime());
    }
    return {
      kinds: kinds.map((k) => {
        const cadence = cadenceByKind.get(k.kind);
        const last = k.last_finished_at ? new Date(k.last_finished_at).getTime() : null;
        return {
          kind: k.kind,
          lastStatus: k.last_status ?? null,
          lastFinishedAt: last !== null ? new Date(last).toISOString() : null,
          runs7d: k.total,
          succeeded7d: k.succeeded + (k.partial ?? 0),
          failed7d: k.failed,
          running: k.running,
          queued: k.queued,
          overdue: cadence !== undefined && (last === null || now - last > cadence * 1.5),
        };
      }),
      memoryJobs,
    };
  } catch (err) {
    console.error('[dashboard/summary] jobs section failed', err);
    return null;
  }
}

async function fetchGovernance(orgId: string): Promise<GovernanceSummary | null> {
  try {
    const [piiRows, model] = await Promise.all([
      prisma.$queryRaw<{ pii_tables: number; pii_pending: number }[]>`
        WITH latest AS (
          SELECT DISTINCT ON (s.subject_id) s.id, s.subject_id, s.card
          FROM platform_context_semantics s
          WHERE s.subject_kind = 'object' AND s.org_id = ${orgId}
          ORDER BY s.subject_id, s.version DESC
        ), flagged AS (
          SELECT l.id
          FROM latest l
          JOIN platform_context_objects o ON o.id = l.subject_id AND o.lifecycle = 'active'
          WHERE jsonb_typeof(l.card->'pii_columns') = 'array' AND jsonb_array_length(l.card->'pii_columns') > 0
        )
        SELECT
          COUNT(*)::int AS pii_tables,
          COUNT(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM platform_sem_audit a
            WHERE a.org_id = ${orgId} AND a.table_name = 'platform_context_semantics' AND a.row_id = f.id::text
          ))::int AS pii_pending
        FROM flagged f
      `,
      prisma.platform_semantic_models.findFirst({
        where: { org_id: orgId, status: 'candidate' },
        select: { id: true, name: true },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    let review: GovernanceSummary['review'] = null;
    if (model) {
      const entityIds = (
        await prisma.platform_sem_entities.findMany({ where: { model_id: model.id, org_id: orgId }, select: { id: true } })
      ).map((e) => e.id);
      const [entities, dimensions, measures] = await Promise.all([
        prisma.platform_sem_entities.count({ where: { model_id: model.id, org_id: orgId, status: 'candidate' } }),
        prisma.platform_sem_dimensions.count({ where: { entity_id: { in: entityIds }, org_id: orgId, status: 'candidate' } }),
        prisma.platform_sem_measures.count({ where: { entity_id: { in: entityIds }, org_id: orgId, status: 'candidate' } }),
      ]);
      if (entities + dimensions + measures > 0) {
        review = { modelId: model.id, name: model.name, entities, dimensions, measures };
      }
    }

    return {
      piiTables: piiRows[0]?.pii_tables ?? 0,
      piiPending: piiRows[0]?.pii_pending ?? 0,
      review,
    };
  } catch (err) {
    console.error('[dashboard/summary] governance section failed', err);
    return null;
  }
}

const SPEND_AREA: Record<string, string> = {
  InspectorChat: 'Ask Data',
  t2_semantic: 'Table descriptions',
  mapping: 'Schema mapping',
};

/**
 * LLM spend from the two places it is recorded: agent_cost_log (Inspector and other
 * agents) and platform_context_jobs.stats.cost_usd (harvest jobs). The sources do not overlap.
 */
async function fetchSpend(orgId: string): Promise<SpendSummary | null> {
  try {
    const [agentRows, jobRows] = await Promise.all([
      prisma.$queryRaw<{ day: number; area: string; usd: number }[]>`
        SELECT
          FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)::int AS day,
          agent_name AS area,
          SUM(cost_usd)::float8 AS usd
        FROM agent_cost_log
        WHERE created_at >= NOW() - INTERVAL '14 days'
        GROUP BY 1, 2
      `,
      prisma.$queryRaw<{ day: number; area: string; usd: number }[]>`
        SELECT
          FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(finished_at, created_at))) / 86400)::int AS day,
          job_kind AS area,
          SUM((stats::jsonb->>'cost_usd')::float8)::float8 AS usd
        FROM platform_context_jobs
        WHERE org_id = ${orgId}
          AND COALESCE(finished_at, created_at) >= NOW() - INTERVAL '14 days'
          AND jsonb_typeof(stats::jsonb->'cost_usd') = 'number'
        GROUP BY 1, 2
      `,
    ]);

    const daily = Array(7).fill(0) as number[];
    const areas = new Map<string, number>();
    let last7d = 0;
    let prev7d = 0;
    for (const r of [...agentRows, ...jobRows]) {
      const usd = Number(r.usd) || 0;
      if (usd <= 0) continue;
      if (r.day < 7) {
        last7d += usd;
        daily[6 - Math.max(0, r.day)] += usd;
        const area = SPEND_AREA[r.area] ?? 'Other';
        areas.set(area, (areas.get(area) ?? 0) + usd);
      } else if (r.day < 14) {
        prev7d += usd;
      }
    }
    return {
      last7d,
      prev7d,
      daily,
      byArea: [...areas.entries()].map(([area, usd]) => ({ area, usd })).sort((a, b) => b.usd - a.usd),
    };
  } catch (err) {
    console.error('[dashboard/summary] spend section failed', err);
    return null;
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export async function getDashboardSummary(
  scope: DashboardScope,
  userId: string,
): Promise<DashboardSummary> {
  const cacheKey = `${userId}:${scope.canReadUsers ? 'admin' : 'member'}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SUMMARY_CACHE_TTL_MS) {
    return cached.data;
  }

  // Estate + memory need the org; resolve once and share (null-safe).
  let orgId: string | null = null;
  try {
    orgId = (await getDefaultOrg()).id;
  } catch (err) {
    console.error('[dashboard/summary] org resolution failed', err);
  }

  // Load sections sequentially so FOER + logins do not open 25+ connections at once.
  const estate = orgId ? await fetchEstate(orgId) : null;
  const memory = orgId ? await fetchMemory(orgId) : null;
  const logins = await fetchLogins(scope);
  const inspector = await fetchInspector(scope, userId);
  const jobs = orgId ? await fetchJobs(orgId) : null;
  const governance = orgId ? await fetchGovernance(orgId) : null;
  const spend = orgId && scope.canReadUsers ? await fetchSpend(orgId) : null;

  const data: DashboardSummary = {
    estate,
    memory,
    logins,
    inspector,
    jobs,
    governance,
    spend,
    generatedAt: new Date().toISOString(),
  };
  summaryCache.set(cacheKey, { at: Date.now(), data });
  return data;
}
