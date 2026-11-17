import { NextRequest, NextResponse } from 'next/server';

import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { buildReportLineage } from '@/lib/powerbi/report-lineage-build';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Stored snapshot status/time; null when none exists or the snapshot table is not migrated yet. */
async function storedSnapshot(orgId: string, reportId: string) {
  try {
    const stored = await prisma.pbiReportLineage.findFirst({
      where: { org_id: orgId, report_id: reportId },
      select: { status: true, generated_at: true, run_id: true },
    });
    return stored ? { status: stored.status, generated_at: stored.generated_at.toISOString(), run_id: stored.run_id } : null;
  } catch (err) {
    console.warn('[api/powerbi/reports/lineage] snapshot unavailable', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Report → measures → model tables → original sources / UC paths, resolved live from harvested
 * Postgres metadata, plus the stored snapshot's status and time (read-only; never writes).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const orgId = await getOrgId();
    const lineage = await buildReportLineage(orgId, id);
    if (!lineage) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ lineage, snapshot: await storedSnapshot(orgId, id) });
  } catch (err) {
    console.error('[api/powerbi/reports/lineage]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
