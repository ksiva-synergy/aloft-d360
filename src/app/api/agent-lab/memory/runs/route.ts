import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  page:     z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  pageSize: z.string().regex(/^\d+$/).transform(Number).optional().default('10'),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  const { page, pageSize } = parsed.data;
  const cappedPageSize = Math.min(pageSize, 100);
  const skip = (page - 1) * cappedPageSize;

  try {
    const org = await getDefaultOrg();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const where = {
      orgId:     org.id,
      startedAt: { gte: since },
    };

    const [runs, total] = await Promise.all([
      prisma.platformMemorySynthesisRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: cappedPageSize,
      }),
      prisma.platformMemorySynthesisRun.count({ where }),
    ]);

    // Fetch details for all returned runs in a single query
    const runIds = runs.map(r => r.id);
    const details = runIds.length > 0
      ? await prisma.platformMemorySynthesisDetail.findMany({
          where: { runId: { in: runIds } },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    // Group details by runId
    const detailsByRunId = details.reduce<Record<string, typeof details>>(
      (acc, d) => {
        (acc[d.runId] ??= []).push(d);
        return acc;
      },
      {},
    );

    const runsWithDetails = runs.map(r => ({
      ...r,
      details: detailsByRunId[r.id] ?? [],
    }));

    return NextResponse.json({ runs: runsWithDetails, total, page });
  } catch (err) {
    console.error('[memory/runs GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
