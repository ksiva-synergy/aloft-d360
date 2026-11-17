import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { buildFidelityReport } from '@/lib/powerbi/fidelity-gate';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelGraph } from '@/lib/powerbi/model-graph';
import {
  type MeasureStatus,
  measureSubgraph,
  modelGraphSummary,
  modelOverview,
} from '@/lib/powerbi/model-graph-view';
import { type ReportConsumer, reportConsumerFromRow } from '@/lib/powerbi/report-measure-refs';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Model graph (L1) + fidelity gate (L0) for Estate.
 *   GET …/graph                 → model summary: node counts, source systems, fidelity issues
 *   GET …/graph?view=overview   → every object grouped by table, node-level edges, relationships
 *   GET …/graph?measure=Name    → source, Power Query steps, DAX dependencies, and reports that use the measure
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const orgId = await getOrgId();
    const model = await prisma.pbiModel.findFirst({
      where: { id, org_id: orgId, lifecycle: 'active' },
      select: { id: true },
    });
    if (!model) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const catalog = await loadMeasureLogicCatalog(orgId, model.id);
    const graph = buildModelGraph(catalog);
    const report = buildFidelityReport(catalog, { graph });

    const measure = req.nextUrl.searchParams.get('measure');
    const view = req.nextUrl.searchParams.get('view');
    if (!measure && view !== 'overview') {
      return NextResponse.json({ summary: modelGraphSummary({ catalog, graph, report }) });
    }

    const status = await loadMeasureStatus(orgId, model.id);
    if (view === 'overview') {
      return NextResponse.json({ overview: modelOverview({ catalog, graph, report, status }) });
    }
    const reports = await loadReportConsumers(orgId, model.id);
    const subgraph = measureSubgraph({ catalog, graph, report, measure: measure!, status, reports });
    if (!subgraph) return NextResponse.json({ error: 'MEASURE_NOT_IN_GRAPH' }, { status: 404 });
    return NextResponse.json({ subgraph });
  } catch (err) {
    console.error('[api/powerbi/models/graph]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

async function loadMeasureStatus(orgId: string, modelId: string): Promise<Map<string, MeasureStatus>> {
  const translations = await prisma.pbiTranslation.findMany({
    where: { org_id: orgId, model_id: modelId },
    select: { measure_name: true, sql_text: true, parity_verdict: true, tier: true },
  });
  const status = new Map<string, MeasureStatus>();
  for (const t of translations) {
    status.set(
      t.measure_name.toLowerCase(),
      t.parity_verdict === 'pass'
        ? 'recreated'
        : t.tier === 'fidelity_gate'
          ? 'blocked'
          : t.sql_text?.trim()
            ? 'sql'
            : 'no_sql',
    );
  }
  return status;
}

async function loadReportConsumers(orgId: string, modelId: string): Promise<ReportConsumer[]> {
  const rows = await prisma.pbiReport.findMany({
    where: { org_id: orgId, model_id: modelId, lifecycle: 'active' },
    select: { id: true, name: true, props: true },
  });
  return rows.map((row) => reportConsumerFromRow(row));
}
