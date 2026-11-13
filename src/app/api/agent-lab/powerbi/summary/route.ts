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
    const [workspaces, models, reports, tables, measures, bindings] = await Promise.all([
      prisma.pbiWorkspace.count({ where: { org_id: orgId, lifecycle: 'active' } }),
      prisma.pbiModel.count({ where: { org_id: orgId, lifecycle: 'active' } }),
      prisma.pbiReport.count({ where: { org_id: orgId, lifecycle: 'active' } }),
      prisma.pbiTable.count({ where: { org_id: orgId, lifecycle: 'active' } }),
      prisma.pbiMeasure.count({ where: { org_id: orgId, lifecycle: 'active' } }),
      prisma.pbiSourceBinding.count({ where: { org_id: orgId } }),
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

    const parseCounts = await prisma.$queryRaw<
      { models_parsed: bigint; models_answerable: bigint; models_caveated: bigint }[]
    >`
      SELECT
        (SELECT COUNT(*)::bigint FROM pbi_models
          WHERE org_id = ${orgId} AND lifecycle = 'active'
            AND (props->'parse'->>'parsed_at') IS NOT NULL) AS models_parsed,
        (SELECT COUNT(*)::bigint FROM pbi_models
          WHERE org_id = ${orgId} AND lifecycle = 'active'
            AND props->'classification'->>'answerability' = 'answerable') AS models_answerable,
        (SELECT COUNT(*)::bigint FROM pbi_models
          WHERE org_id = ${orgId} AND lifecycle = 'active'
            AND props->'classification'->>'answerability' = 'caveated') AS models_caveated
    `;
    const parseRow = parseCounts[0] ?? {
      models_parsed: BigInt(0),
      models_answerable: BigInt(0),
      models_caveated: BigInt(0),
    };

    return NextResponse.json({
      workspaces,
      models,
      reports,
      tables,
      measures,
      source_bindings: bindings,
      models_with_definition: Number(row.models_with_definition),
      reports_with_definition: Number(row.reports_with_definition),
      models_parsed: Number(parseRow.models_parsed),
      models_answerable: Number(parseRow.models_answerable),
      models_caveated: Number(parseRow.models_caveated),
      raw_store_root: process.env.PBI_RAW_STORE_ROOT ? '(configured)' : 'powerbi-estate/',
    });
  } catch (err) {
    console.error('[powerbi/summary GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
