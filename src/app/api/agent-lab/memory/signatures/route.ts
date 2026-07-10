import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/org';
import { prisma } from '@/lib/prisma';
import { getCurrentTopicMap } from '@/lib/foer/topics';

export const dynamic = 'force-dynamic';

export interface SignatureEntry {
  taskSignature: string;
  topicKey:      string;
  topicName:     string;
  topicRank:     number;
  memberCount:   number;
  shortLabel:    string | null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = getDefaultOrg();

    // Distinct active task signatures — also grab shortLabel (one per sig, use the most recent)
    const rows = await prisma.platformAgentMemory.findMany({
      where:   { orgId: org.id, status: 'ACTIVE', taskSignature: { not: null } },
      select:  { taskSignature: true, shortLabel: true },
      distinct: ['taskSignature'],
      orderBy: { createdAt: 'desc' },
    });

    const signatures = rows
      .map((r) => r.taskSignature)
      .filter((s): s is string => s !== null && s.length > 0);

    // Build shortLabel map (first occurrence per signature = most recent)
    const shortLabelMap = new Map<string, string | null>();
    for (const r of rows) {
      if (r.taskSignature && !shortLabelMap.has(r.taskSignature)) {
        shortLabelMap.set(r.taskSignature, r.shortLabel ?? null);
      }
    }

    const topicMap = await getCurrentTopicMap(org.id);

    const entries: SignatureEntry[] = signatures.map((sig) => {
      const topic = topicMap.get(sig);
      return {
        taskSignature: sig,
        topicKey:      topic?.topicKey   ?? 'unassigned',
        topicName:     topic?.topicName  ?? 'Unassigned',
        topicRank:     topic?.rank       ?? 9999,
        memberCount:   1,
        shortLabel:    shortLabelMap.get(sig) ?? null,
      };
    });

    // Hydrate memberCount from topic map rows (memberCount lives in PlatformMemoryTopic)
    const latest = await getLatestPeriod(org.id);
    if (latest) {
      const topicRows = await prisma.platformMemoryTopic.findMany({
        where:  { orgId: org.id, period: latest },
        select: { taskSignature: true, memberCount: true },
      });
      const countMap = new Map(topicRows.map((r) => [r.taskSignature, r.memberCount]));
      for (const entry of entries) {
        const mc = countMap.get(entry.taskSignature);
        if (mc !== undefined) entry.memberCount = mc;
      }
    }

    entries.sort((a, b) => {
      if (a.topicRank !== b.topicRank) return a.topicRank - b.topicRank;
      if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
      return a.taskSignature.localeCompare(b.taskSignature);
    });

    return NextResponse.json({ signatures: entries });
  } catch (err) {
    console.error('[memory/signatures GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

async function getLatestPeriod(orgId: string): Promise<string | null> {
  const row = await prisma.platformMemoryTopic.findFirst({
    where:   { orgId },
    select:  { period: true },
    orderBy: { period: 'desc' },
  });
  return row?.period ?? null;
}
