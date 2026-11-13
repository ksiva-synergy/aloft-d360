import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const [domains, conflicts] = await Promise.all([
      prisma.pbiDomain.findMany({
        where: { org_id: orgId },
        orderBy: { rollout_wave: 'asc' },
        include: { _count: { select: { models: true } } },
      }),
      prisma.pbiConflict.findMany({
        where: { org_id: orgId, status: 'proposed' },
        orderBy: { metric_name: 'asc' },
        take: 100,
      }),
    ]);

    return NextResponse.json({
      domains: domains.map((d) => ({
        id: d.id,
        domain_key: d.domain_key,
        name: d.name,
        rollout_wave: d.rollout_wave,
        model_count: d._count.models,
      })),
      conflicts: conflicts.map((c) => ({
        id: c.id,
        metric_name: c.metric_name,
        summary: c.summary,
        model_ids: c.model_ids,
        domain_keys: c.domain_keys,
      })),
    });
  } catch (err) {
    console.error('[powerbi/domains GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
