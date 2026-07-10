import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  agentClass: z.string().optional(),
  ruleType:   z.string().optional(),
  status:     z.string().optional().default('ACTIVE'),
  page:       z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  pageSize:   z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
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

  const { agentClass, ruleType, status, page, pageSize } = parsed.data;
  const cappedPageSize = Math.min(pageSize, 500);
  const skip = (page - 1) * cappedPageSize;

  try {
    const org = await getDefaultOrg();

    const where = {
      orgId:      org.id,
      ...(agentClass ? { agentClass }         : {}),
      ...(ruleType   ? { ruleType }            : {}),
      ...(status     ? { status }              : {}),
    };

    const [bullets, total] = await Promise.all([
      prisma.platformAgentMemory.findMany({
        where,
        select: {
          id:               true,
          agentClass:       true,
          taskSignature:    true,
          shortLabel:       true,
          blurb:            true,
          ruleText:         true,
          ruleType:         true,
          confidence:       true,
          helpfulCount:     true,
          harmfulCount:     true,
          status:           true,
          version:          true,
          sourceSessionIds: true,
          validFrom:        true,
          validUntil:       true,
          lastUsedAt:       true,
          createdAt:        true,
          updatedAt:        true,
        },
        orderBy: [
          { helpfulCount: 'desc' },
          { confidence: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: cappedPageSize,
      }),
      prisma.platformAgentMemory.count({ where }),
    ]);

    return NextResponse.json({ bullets, total, page });
  } catch (err) {
    console.error('[memory/browse GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
