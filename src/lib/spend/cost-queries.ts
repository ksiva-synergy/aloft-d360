import { prisma } from '@/lib/db';

const MS_DAY = 86400000;

export interface CostSummaryResponse {
  from: string;
  to: string;
  interactive: {
    totalUsd: number;
    eventCount: number;
    bySurface: { surface: string; usd: number; count: number }[];
    dailyUsd: number[];
  };
  harvest: {
    totalUsd: number;
    eventCount: number;
    llmUsd: number;
    infraUsd: number;
    byKind: { jobKind: string; usd: number; count: number }[];
    dailyUsd: number[];
  };
  byUser: { userId: string; email: string | null; name: string | null; interactiveUsd: number; harvestUsd: number }[];
}

function sumUsd(rows: { usd: unknown }[]): number {
  return rows.reduce((s, r) => s + Number(r.usd ?? 0), 0);
}

export async function fetchCostSummary(orgId: string, days: number): Promise<CostSummaryResponse> {
  const to = new Date();
  const from = new Date(to.getTime() - days * MS_DAY);

  const events = await prisma.platformSpendEvent.findMany({
    where: { org_id: orgId, occurred_at: { gte: from, lte: to } },
    select: {
      bucket: true,
      surface: true,
      action: true,
      usd: true,
      user_id: true,
      job_kind: true,
      occurred_at: true,
    },
    orderBy: { occurred_at: 'asc' },
  });

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
  for (const e of interactive) {
    const cur = bySurfaceMap.get(e.surface) ?? { usd: 0, count: 0 };
    cur.usd += Number(e.usd);
    cur.count += 1;
    bySurfaceMap.set(e.surface, cur);
  }

  const byKindMap = new Map<string, { usd: number; count: number }>();
  for (const e of harvest) {
    const kind = e.job_kind ?? 'unknown';
    const cur = byKindMap.get(kind) ?? { usd: 0, count: 0 };
    cur.usd += Number(e.usd);
    cur.count += 1;
    byKindMap.set(kind, cur);
  }

  const dailyInteractive = Array(days).fill(0) as number[];
  const dailyHarvest = Array(days).fill(0) as number[];
  for (const e of events) {
    const dayIndex = Math.floor((e.occurred_at.getTime() - from.getTime()) / MS_DAY);
    if (dayIndex < 0 || dayIndex >= days) continue;
    const usd = Number(e.usd);
    if (e.bucket === 'interactive') dailyInteractive[dayIndex] += usd;
    else if (e.bucket === 'harvest') dailyHarvest[dayIndex] += usd;
  }

  const userAgg = new Map<string, { interactiveUsd: number; harvestUsd: number }>();
  for (const e of events) {
    if (!e.user_id) continue;
    const cur = userAgg.get(e.user_id) ?? { interactiveUsd: 0, harvestUsd: 0 };
    const usd = Number(e.usd);
    if (e.bucket === 'interactive') cur.interactiveUsd += usd;
    else if (e.bucket === 'harvest') cur.harvestUsd += usd;
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
      };
    })
    .sort((a, b) => b.interactiveUsd + b.harvestUsd - (a.interactiveUsd + a.harvestUsd));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    interactive: {
      totalUsd: sumUsd(interactive),
      eventCount: interactive.length,
      bySurface: [...bySurfaceMap.entries()]
        .map(([surface, v]) => ({ surface, usd: v.usd, count: v.count }))
        .sort((a, b) => b.usd - a.usd),
      dailyUsd: dailyInteractive,
    },
    harvest: {
      totalUsd: sumUsd(harvest),
      eventCount: harvest.length,
      llmUsd: harvestLlmUsd,
      infraUsd: harvestInfraUsd,
      byKind: [...byKindMap.entries()]
        .map(([jobKind, v]) => ({ jobKind, usd: v.usd, count: v.count }))
        .sort((a, b) => b.usd - a.usd),
      dailyUsd: dailyHarvest,
    },
    byUser,
  };
}

export interface SpendEventRow {
  id: string;
  occurredAt: string;
  bucket: string;
  surface: string;
  action: string;
  usd: number;
  userId: string | null;
  userEmail: string | null;
  model: string | null;
  jobKind: string | null;
  agentSlug: string | null;
  sessionId: string | null;
  jobId: string | null;
  status: string | null;
  meta: unknown;
}

export async function fetchSpendEvents(
  orgId: string,
  opts: { bucket?: string; userId?: string; days: number; limit: number; offset: number },
): Promise<{ total: number; events: SpendEventRow[] }> {
  const to = new Date();
  const from = new Date(to.getTime() - opts.days * MS_DAY);
  const where = {
    org_id: orgId,
    occurred_at: { gte: from, lte: to },
    ...(opts.bucket ? { bucket: opts.bucket } : {}),
    ...(opts.userId ? { user_id: opts.userId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.platformSpendEvent.count({ where }),
    prisma.platformSpendEvent.findMany({
      where,
      orderBy: { occurred_at: 'desc' },
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
      meta: r.meta,
    })),
  };
}
