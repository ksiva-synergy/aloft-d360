import { prisma } from '@/lib/prisma';
import { getTopicPeriods } from '@/lib/foer/topics';
import type { StatsResponse, FoerTopic, LastRunInfo } from '@/lib/foer/types';

/**
 * Compute the full FOER stats payload for a given org in one pass.
 * All DB queries run concurrently; topic lookup is sequential (needs latest period first).
 */
export async function computeMemoryStats(orgId: string): Promise<StatsResponse> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo   = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    sessionGroups,
    totalTraceNodes,
    nodeTypeGroups,
    lastTraceNode,
    activeBullets,
    coreMemories,
    ruleTypeGroups,
    memStats,
    lastRun,
    phantomResult,
    injectedCount,
    statusGroups,
    activeMemoriesForSeries,
    lastNRunsDb,
    watermarkRows,
    processedRows,
  ] = await Promise.all([
    prisma.platformTraceNode.groupBy({
      by: ['sessionId'],
      where: { orgId },
    }),
    prisma.platformTraceNode.count({ where: { orgId } }),
    prisma.platformTraceNode.groupBy({
      by: ['nodeType'],
      where: { orgId },
      _count: { _all: true },
    }),
    prisma.platformTraceNode.findFirst({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.platformAgentMemory.count({ where: { orgId, status: 'ACTIVE' } }),
    prisma.platformAgentMemory.count({ where: { orgId, status: 'ACTIVE', ruleType: 'HARD_RULE' } }),
    prisma.platformAgentMemory.groupBy({
      by: ['ruleType'],
      where: { orgId, status: 'ACTIVE' },
      _count: { _all: true },
    }),
    prisma.platformAgentMemory.aggregate({
      where: { orgId, status: 'ACTIVE' },
      _sum: { helpfulCount: true, harmfulCount: true },
    }),
    prisma.platformMemorySynthesisRun.findFirst({
      where: { orgId, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        sessionsScanned: true,
        sessionsReflected: true,
        sessionsSkipped: true,
        bulletsInserted: true,
        bulletsDeduped: true,
        bulletsSuperseded: true,
        phantomsBlocked: true,
        bulletsQuarantined: true,
        reflectorVersion: true,
        completedAt: true,
      },
    }),
    prisma.platformMemorySynthesisRun.aggregate({
      where: { orgId, completedAt: { gte: sevenDaysAgo } },
      _sum: { phantomsBlocked: true },
    }),
    prisma.platformAgentMemory.count({
      where: { orgId, status: 'ACTIVE', lastUsedAt: { gte: oneDayAgo } },
    }),
    prisma.platformAgentMemory.groupBy({
      by: ['status'],
      where: { orgId },
      _count: { _all: true },
    }),
    prisma.platformAgentMemory.findMany({
      where: { orgId, status: 'ACTIVE' },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.platformMemorySynthesisRun.findMany({
      where: { orgId, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: 7,
      select: {
        id: true,
        sessionsScanned: true,
        sessionsReflected: true,
        sessionsSkipped: true,
        bulletsInserted: true,
        bulletsDeduped: true,
        bulletsSuperseded: true,
        phantomsBlocked: true,
        bulletsQuarantined: true,
        reflectorVersion: true,
        completedAt: true,
      },
    }),
    prisma.$queryRaw<{ max_ts: Date | null }[]>`
      SELECT MAX(created_at) AS max_ts
      FROM platform_agent_memory
      WHERE org_id = ${orgId} AND status = 'ACTIVE'
    `,
    prisma.$queryRaw<{ source_session_ids: string[] }[]>`
      SELECT source_session_ids
      FROM platform_agent_memory
      WHERE org_id = ${orgId} AND status = 'ACTIVE'
    `,
  ]);

  // Unprocessed sessions — mirrors findUnprocessedSessions() in run-sweep.ts exactly:
  // sessions with at least one trace node newer than the watermark that haven't yet
  // been distilled into bullets.
  const watermark: Date = watermarkRows[0]?.max_ts ?? new Date(0);
  const processedSessionIds = new Set<string>();
  for (const row of processedRows) {
    for (const sid of row.source_session_ids ?? []) processedSessionIds.add(sid);
  }
  type SidRow = { session_id: string };
  const candidateRows = await prisma.$queryRaw<SidRow[]>`
    SELECT DISTINCT session_id
    FROM platform_trace_nodes
    WHERE org_id = ${orgId}
      AND created_at > ${watermark}
  `;
  const unprocessedSessions = candidateRows.filter(r => !processedSessionIds.has(r.session_id)).length;

  // Topics — requires latest period; runs after the parallel block
  const periods = await getTopicPeriods(orgId);
  const latestPeriod = periods[0] ?? null;

  let topics: FoerTopic[] = [];
  let lastClusteredAt: string | null = null;
  let totalActiveSigs = 0;
  let assignedSigs = 0;

  if (latestPeriod) {
    const [topicRows, lastTopicRow, totalSigsRows, assignedSigsRows] = await Promise.all([
      prisma.platformMemoryTopic.findMany({
        where:   { orgId, period: latestPeriod },
        select:  { topicKey: true, topicName: true, topicRank: true, memberCount: true },
        orderBy: { topicRank: 'asc' },
      }),
      prisma.platformMemoryTopic.findFirst({
        where:   { orgId, period: latestPeriod },
        orderBy: { createdAt: 'desc' },
        select:  { createdAt: true },
      }),
      prisma.platformAgentMemory.findMany({
        where:   { orgId, status: 'ACTIVE', taskSignature: { not: null } },
        select:  { taskSignature: true },
        distinct: ['taskSignature'],
      }),
      prisma.platformMemoryTopic.findMany({
        where:  { orgId, period: latestPeriod, taskSignature: { not: '' } },
        select: { taskSignature: true },
        distinct: ['taskSignature'],
      }),
    ]);

    const seen = new Map<string, FoerTopic>();
    for (const r of topicRows) {
      if (!seen.has(r.topicKey)) {
        seen.set(r.topicKey, {
          topicKey:    r.topicKey,
          topicName:   r.topicName,
          memberCount: r.memberCount,
          rank:        r.topicRank,
        });
      }
    }
    topics = [...seen.values()];
    lastClusteredAt = lastTopicRow?.createdAt.toISOString() ?? null;
    totalActiveSigs = totalSigsRows.length;
    assignedSigs    = assignedSigsRows.length;
  } else {
    // No topic period yet — count active signatures for coverage denominator
    const totalSigsRows = await prisma.platformAgentMemory.findMany({
      where:   { orgId, status: 'ACTIVE', taskSignature: { not: null } },
      select:  { taskSignature: true },
      distinct: ['taskSignature'],
    });
    totalActiveSigs = totalSigsRows.length;
  }

  const helpfulTotal = memStats._sum.helpfulCount ?? 0;
  const harmfulTotal = memStats._sum.harmfulCount ?? 0;
  const helpfulHarmfulRatio =
    helpfulTotal + harmfulTotal === 0
      ? 0
      : helpfulTotal / (helpfulTotal + harmfulTotal);

  const nodeTypeDistribution: Record<string, number> = {};
  for (const g of nodeTypeGroups) nodeTypeDistribution[g.nodeType] = g._count._all;

  const ruleTypeDistribution: Record<string, number> = {};
  for (const g of ruleTypeGroups) ruleTypeDistribution[g.ruleType] = g._count._all;

  // Process status buckets
  const statusBuckets = { ACTIVE: 0, SUPERSEDED: 0, EXPIRED: 0, QUARANTINED: 0 };
  for (const g of statusGroups) {
    const statusKey = (g.status || '').toUpperCase();
    if (statusKey === 'ACTIVE' || statusKey === 'SUPERSEDED' ||
        statusKey === 'EXPIRED' || statusKey === 'QUARANTINED') {
      statusBuckets[statusKey as keyof typeof statusBuckets] = g._count._all;
    }
  }

  // Process daily cumulative storeSizeSeries (active count by date of creation)
  const storeSizeSeries: { date: string; active: number }[] = [];
  const distinctDays = new Set(
    activeMemoriesForSeries.map((m) => m.createdAt.toISOString().split('T')[0])
  );
  if (distinctDays.size >= 2) {
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      days.push(d.toISOString().split('T')[0]);
    }
    for (const dayStr of days) {
      const endOfDay = new Date(`${dayStr}T23:59:59.999Z`).getTime();
      const activeCount = activeMemoriesForSeries.filter(
        (m) => m.createdAt.getTime() <= endOfDay
      ).length;
      storeSizeSeries.push({
        date: new Date(`${dayStr}T00:00:00.000Z`).toISOString(),
        active: activeCount,
      });
    }
  }

  return {
    tracedSessions:       sessionGroups.length,
    unprocessedSessions,
    totalTraceNodes,
    nodeTypeDistribution,
    lastTraceAt:          lastTraceNode?.createdAt.toISOString() ?? null,
    activeBullets,
    coreMemories,
    ruleTypeDistribution,
    helpfulHarmfulRatio,
    helpfulTotal,
    harmfulTotal,
    lastSynthesisAt:      lastRun?.completedAt?.toISOString() ?? null,
    phantomsBlocked7d:    phantomResult._sum.phantomsBlocked ?? 0,
    topicCount:           topics.length,
    topics,
    injectedLast24h:      injectedCount,
    injectedLast24hPending: false,
    statusBuckets,
    storeSizeSeries,
    lastRun: lastRun
      ? ({
          id:                 lastRun.id,
          sessionsScanned:    lastRun.sessionsScanned    ?? 0,
          sessionsReflected:  lastRun.sessionsReflected  ?? 0,
          sessionsSkipped:    lastRun.sessionsSkipped     ?? 0,
          bulletsInserted:    lastRun.bulletsInserted     ?? 0,
          bulletsDeduped:     lastRun.bulletsDeduped      ?? 0,
          bulletsSuperseded:  lastRun.bulletsSuperseded   ?? 0,
          phantomsBlocked:    lastRun.phantomsBlocked     ?? 0,
          bulletsQuarantined: lastRun.bulletsQuarantined  ?? 0,
          reflectorVersion:   lastRun.reflectorVersion    ?? null,
          completedAt:        lastRun.completedAt!.toISOString(),
        } satisfies LastRunInfo)
      : null,
    lastNRuns: lastNRunsDb.map((r) => ({
      id:                 r.id,
      sessionsScanned:    r.sessionsScanned    ?? 0,
      sessionsReflected:  r.sessionsReflected  ?? 0,
      sessionsSkipped:    r.sessionsSkipped     ?? 0,
      bulletsInserted:    r.bulletsInserted     ?? 0,
      bulletsDeduped:     r.bulletsDeduped      ?? 0,
      bulletsSuperseded:  r.bulletsSuperseded   ?? 0,
      phantomsBlocked:    r.phantomsBlocked     ?? 0,
      bulletsQuarantined: r.bulletsQuarantined  ?? 0,
      reflectorVersion:   r.reflectorVersion    ?? null,
      completedAt:        r.completedAt!.toISOString(),
    } satisfies LastRunInfo)),
    flagStatus: {
      enabled:          process.env.MEMORY_INJECT_ENABLED === 'true',
      topicCoverage:    topics.length,
      coveragePercent:  totalActiveSigs > 0 ? Math.round((assignedSigs / totalActiveSigs) * 100) : 0,
      lastClusteredAt,
    },
  };
}
