import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(req, ['estate.catalog', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const [workspaces, models, reports] = await Promise.all([
      prisma.pbiWorkspace.count({ where: { org_id: orgId, lifecycle: 'active' } }),
      prisma.pbiModel.count({ where: { org_id: orgId, lifecycle: 'active' } }),
      prisma.pbiReport.count({ where: { org_id: orgId, lifecycle: 'active' } }),
    ]);

    const defCounts = await prisma.$queryRaw<{ models_with_definition: bigint; reports_with_definition: bigint }[]>`
      SELECT
        (SELECT COUNT(*)::bigint FROM pbi_models
          WHERE org_id = ${orgId} AND lifecycle = 'active'
            AND (props->'definition'->>'fetched_at') IS NOT NULL) AS models_with_definition,
        (SELECT COUNT(*)::bigint FROM pbi_reports
          WHERE org_id = ${orgId} AND lifecycle = 'active'
            AND (props->'definition'->>'fetched_at') IS NOT NULL) AS reports_with_definition
    `;

    const row = defCounts[0] ?? { models_with_definition: BigInt(0), reports_with_definition: BigInt(0) };

    return NextResponse.json({
      workspaces,
      models,
      reports,
      models_with_definition: Number(row.models_with_definition),
      reports_with_definition: Number(row.reports_with_definition),
      raw_store_root: process.env.PBI_RAW_STORE_ROOT ? '(configured)' : 'powerbi-estate/',
    });
  } catch (err) {
    console.error('[powerbi/summary GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
