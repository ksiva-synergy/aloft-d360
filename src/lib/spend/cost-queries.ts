import { prisma } from '@/lib/db';
import type { CostSummaryResponse, SpendEventRow, SpendEventSort } from '@/lib/spend/cost-types';

export type { CostSummaryResponse, SpendEventRow, SpendEventSort } from '@/lib/spend/cost-types';

const MS_DAY = 86400000;

function sumUsd(rows: { usd: unknown }[]): number {
  return rows.reduce((s, r) => s + Number(r.usd ?? 0), 0);
}

function bump<K>(map: Map<K, { usd: number; count: number }>, key: K, usd: number) {
  const cur = map.get(key) ?? { usd: 0, count: 0 };
  cur.usd += usd;
  cur.count += 1;
  map.set(key, cur);
}

function ranked<K extends string>(map: Map<K, { usd: number; count: number }>) {
  return [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.usd - a.usd);
}

export async function fetchCostSummary(orgId: string, days: number): Promise<CostSummaryResponse> {
  const to = new Date();
  const from = new Date(to.getTime() - days * MS_DAY);
  const prevFrom = new Date(from.getTime() - days * MS_DAY);

  const [events, previousByBucket] = await Promise.all([
    prisma.platformSpendEvent.findMany({
      where: { org_id: orgId, occurred_at: { gte: from, lte: to } },
      select: {
        bucket: true,
        surface: true,
        action: true,
        usd: true,
        user_id: true,
        job_kind: true,
        model: true,
        agent_slug: true,
        status: true,
        input_tokens: true,
        output_tokens: true,
        cache_read_tokens: true,
        cache_write_tokens: true,
        occurred_at: true,
      },
      orderBy: { occurred_at: 'asc' },
    }),
    // Same-length window immediately before this one, for period-over-period deltas.
    prisma.platformSpendEvent.groupBy({
      by: ['bucket'],
      where: { org_id: orgId, occurred_at: { gte: prevFrom, lt: from } },
      _sum: { usd: true },
      _count: { _all: true },
    }),
  ]);

  const interactive = events.filter((e) => e.bucket === 'interactive');
  const harvest = events.filter((e) => e.bucket === 'harvest');
  let harvestLlmUsd = 0;
  let harvestInfraUsd = 0;
  for (const e of harvest) {
    const usd = Number(e.usd);
    if (e.action === 'job_infra') harvestInfraUsd += usd;
    else harvestLlmUsd += usd;
  }

  const bySurfaceMap = new Map<string, { usd: number; count: number }>();
  const byModelMap = new Map<string, { usd: number; count: number }>();
  const byAgentMap = new Map<string, { usd: number; count: number }>();
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let interactiveFailed = 0;
  for (const e of interactive) {
    const usd = Number(e.usd);
    bump(bySurfaceMap, e.surface, usd);
    bump(byModelMap, e.model ?? 'unknown', usd);
    if (e.agent_slug) bump(byAgentMap, e.agent_slug, usd);
    tokens.input += e.input_tokens ?? 0;
    tokens.output += e.output_tokens ?? 0;
    tokens.cacheRead += e.cache_read_tokens ?? 0;
    tokens.cacheWrite += e.cache_write_tokens ?? 0;
    if (e.status && e.status !== 'success') interactiveFailed += 1;
  }

  const byKindMap = new Map<string, { usd: number; count: number }>();
  for (const e of harvest) bump(byKindMap, e.job_kind ?? 'unknown', Number(e.usd));

  const dailyInteractive = Array(days).fill(0) as number[];
  const dailyHarvest = Array(days).fill(0) as number[];
  for (const e of events) {
    const dayIndex = Math.floor((e.occurred_at.getTime() - from.getTime()) / MS_DAY);
    if (dayIndex < 0 || dayIndex >= days) continue;
    const usd = Number(e.usd);
    if (e.bucket === 'interactive') dailyInteractive[dayIndex] += usd;
    else if (e.bucket === 'harvest') dailyHarvest[dayIndex] += usd;
  }

  const userAgg = new Map<
    string,
    { interactiveUsd: number; harvestUsd: number; interactiveCount: number; harvestCount: number; lastAt: Date }
  >();
  for (const e of events) {
    if (!e.user_id) continue;
    const cur = userAgg.get(e.user_id) ?? {
      interactiveUsd: 0,
      harvestUsd: 0,
      interactiveCount: 0,
      harvestCount: 0,
      lastAt: e.occurred_at,
    };
    const usd = Number(e.usd);
    if (e.bucket === 'interactive') {
      cur.interactiveUsd += usd;
      cur.interactiveCount += 1;
    } else if (e.bucket === 'harvest') {
      cur.harvestUsd += usd;
      cur.harvestCount += 1;
    }
    if (e.occurred_at > cur.lastAt) cur.lastAt = e.occurred_at;
    userAgg.set(e.user_id, cur);
  }

  const userIds = [...userAgg.keys()];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const byUser = userIds
    .map((userId) => {
      const agg = userAgg.get(userId)!;
      const u = userById.get(userId);
      return {
        userId,
        email: u?.email ?? null,
        name: u?.name ?? null,
        interactiveUsd: agg.interactiveUsd,
        harvestUsd: agg.harvestUsd,
        interactiveCount: agg.interactiveCount,
        harvestCount: agg.harvestCount,
        lastAt: agg.lastAt.toISOString(),
      };
    })
    .sort((a, b) => b.interactiveUsd + b.harvestUsd - (a.interactiveUsd + a.harvestUsd));

  const prev = (bucket: string) => previousByBucket.find((r) => r.bucket === bucket);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    days,
    interactive: {
      totalUsd: sumUsd(interactive),
      eventCount: interactive.length,
      failedCount: interactiveFailed,
      bySurface: ranked(bySurfaceMap).map(({ key, usd, count }) => ({ surface: key, usd, count })),
      byModel: ranked(byModelMap).map(({ key, usd, count }) => ({ model: key, usd, count })),
      byAgent: ranked(byAgentMap)
        .slice(0, 12)
        .map(({ key, usd, count }) => ({ agentSlug: key, usd, count })),
      tokens,
      dailyUsd: dailyInteractive,
    },
    harvest: {
      totalUsd: sumUsd(harvest),
      eventCount: harvest.length,
      llmUsd: harvestLlmUsd,
      infraUsd: harvestInfraUsd,
      byKind: ranked(byKindMap).map(({ key, usd, count }) => ({ jobKind: key, usd, count })),
      dailyUsd: dailyHarvest,
    },
    previous: {
      from: prevFrom.toISOString(),
      interactiveUsd: Number(prev('interactive')?._sum.usd ?? 0),
      harvestUsd: Number(prev('harvest')?._sum.usd ?? 0),
      interactiveCount: prev('interactive')?._count._all ?? 0,
      harvestCount: prev('harvest')?._count._all ?? 0,
    },
    byUser,
  };
}

export async function fetchSpendEvents(
  orgId: string,
  opts: {
    bucket?: string;
    userId?: string;
    surface?: string;
    model?: string;
    jobKind?: string;
    q?: string;
    sort?: SpendEventSort;
    days: number;
    limit: number;
    offset: number;
  },
): Promise<{ total: number; totalUsd: number; events: SpendEventRow[] }> {
  const to = new Date();
  const from = new Date(to.getTime() - opts.days * MS_DAY);
  const q = opts.q?.trim();
  const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });
  const where = {
    org_id: orgId,
    occurred_at: { gte: from, lte: to },
    ...(opts.bucket ? { bucket: opts.bucket } : {}),
    ...(opts.userId ? { user_id: opts.userId } : {}),
    ...(opts.surface ? { surface: opts.surface } : {}),
    // 'unknown' is the summary's label for a null model / job kind.
    ...(opts.model ? { model: opts.model === 'unknown' ? null : opts.model } : {}),
    ...(opts.jobKind ? { job_kind: opts.jobKind === 'unknown' ? null : opts.jobKind } : {}),
    ...(q
      ? {
          OR: [
            { surface: contains(q) },
            { action: contains(q) },
            { model: contains(q) },
            { agent_slug: contains(q) },
            { job_kind: contains(q) },
            { session_id: contains(q) },
          ],
        }
      : {}),
  };

  const [total, agg, rows] = await Promise.all([
    prisma.platformSpendEvent.count({ where }),
    prisma.platformSpendEvent.aggregate({ where, _sum: { usd: true } }),
    prisma.platformSpendEvent.findMany({
      where,
      orderBy:
        opts.sort === 'cost'
          ? [{ usd: 'desc' as const }, { occurred_at: 'desc' as const }]
          : [{ occurred_at: 'desc' as const }],
      take: opts.limit,
      skip: opts.offset,
      select: {
        id: true,
        occurred_at: true,
        bucket: true,
        surface: true,
        action: true,
        usd: true,
        user_id: true,
        model: true,
        job_kind: true,
        agent_slug: true,
        session_id: true,
        job_id: true,
        status: true,
        input_tokens: true,
        output_tokens: true,
        cache_read_tokens: true,
        cache_write_tokens: true,
        meta: true,
      },
    }),
  ]);

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : [];
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return {
    total,
    totalUsd: Number(agg._sum.usd ?? 0),
    events: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at.toISOString(),
      bucket: r.bucket,
      surface: r.surface,
      action: r.action,
      usd: Number(r.usd),
      userId: r.user_id,
      userEmail: r.user_id ? (emailById.get(r.user_id) ?? null) : null,
      model: r.model,
      jobKind: r.job_kind,
      agentSlug: r.agent_slug,
      sessionId: r.session_id,
      jobId: r.job_id,
      status: r.status,
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      cacheReadTokens: r.cache_read_tokens ?? 0,
      cacheWriteTokens: r.cache_write_tokens ?? 0,
      meta: r.meta,
    })),
  };
}
