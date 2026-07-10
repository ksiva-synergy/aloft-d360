import { prisma } from '@/lib/prisma';

export interface TopicEntry {
  topicKey: string;
  topicName: string;
  rank: number;
}

/** Returns the current period string (YYYY-MM) in UTC. */
export function currentPeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export const ALL_KNOWLEDGE_KEY = 'all_knowledge';

/**
 * Loads the latest period's topic assignments for an org.
 * Returns Map<task_signature, TopicEntry>.
 * Falls back to an empty map if no rows exist (e.g. before the first sweep).
 */
export async function getCurrentTopicMap(orgId: string): Promise<Map<string, TopicEntry>> {
  const latest = await getLatestPeriod(orgId);
  if (!latest) return new Map();

  const [rows, activeSigs] = await Promise.all([
    prisma.platformMemoryTopic.findMany({
      where: { orgId, period: latest },
      select: { taskSignature: true, topicKey: true, topicName: true, topicRank: true },
    }),
    prisma.platformAgentMemory.findMany({
      where: {
        orgId,
        status: 'ACTIVE',
        taskSignature: { not: null },
      },
      select: { taskSignature: true },
      distinct: ['taskSignature'],
    }),
  ]);

  const map = new Map<string, TopicEntry>();

  for (const r of rows) {
    if (r.taskSignature) {
      map.set(r.taskSignature, {
        topicKey: r.topicKey,
        topicName: r.topicName,
        rank: r.topicRank,
      });
    }
  }

  for (const item of activeSigs) {
    const sig = item.taskSignature!;
    if (!map.has(sig)) {
      map.set(sig, {
        topicKey: ALL_KNOWLEDGE_KEY,
        topicName: 'All Knowledge',
        rank: 9999,
      });
    }
  }

  return map;
}

/** Returns all distinct periods for an org, newest first. */
export async function getTopicPeriods(orgId: string): Promise<string[]> {
  const rows = await prisma.platformMemoryTopic.findMany({
    where: { orgId },
    select: { period: true },
    distinct: ['period'],
    orderBy: { period: 'desc' },
  });
  return rows.map((r) => r.period);
}

async function getLatestPeriod(orgId: string): Promise<string | null> {
  const periods = await getTopicPeriods(orgId);
  return periods[0] ?? null;
}
