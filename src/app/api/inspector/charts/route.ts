import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { computeMeasureSnapshots } from '@/lib/dashboards/governance';
import type { SemanticQuery } from '@/lib/semantic/types';
import type { ChartDSLSpec } from '@/lib/studio/chart-dsl';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/charts?modelId=X
 * Lists non-deleted saved charts for the default org scoped to a semantic model.
 *
 * POST /api/inspector/charts
 * Promotes a semantic chart result from an Inspector session into a saved chart.
 * Freezes measure_snapshots at creation time using computeMeasureSnapshots.
 * Body: { modelId, name, description?, chartDsl, semanticQuery, createdBy? }
 */

export async function GET(request: NextRequest) {
  try {
    const org = await getDefaultOrg();
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get('modelId');

    if (!modelId) {
      return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
    }

    const charts = await prisma.platform_charts.findMany({
      where: {
        org_id: org.id,
        model_id: modelId,
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
    });

    return NextResponse.json({ charts });
  } catch (err) {
    console.error('[charts GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const org = await getDefaultOrg();
    const body = await request.json() as {
      modelId: string;
      name: string;
      description?: string;
      chartDsl: ChartDSLSpec;
      semanticQuery: SemanticQuery;
      createdBy?: string;
    };

    if (!body.modelId || !body.name || !body.chartDsl || !body.semanticQuery) {
      return NextResponse.json(
        { error: 'modelId, name, chartDsl, and semanticQuery are required' },
        { status: 400 },
      );
    }

    // Confirm the model exists and belongs to this org
    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: body.modelId, org_id: org.id },
    });
    if (!model) {
      return NextResponse.json({ error: 'Semantic model not found' }, { status: 404 });
    }

    // Freeze measure snapshots at save time — same pattern as version-save in D1
    const measureIds = body.semanticQuery.measures.map((m) => m.measureId);
    const measureSnapshots = await computeMeasureSnapshots(measureIds, org.id);

    const id = createId();
    const actor = body.createdBy ?? 'system';

    const chart = await prisma.platform_charts.create({
      data: {
        id,
        org_id: org.id,
        model_id: body.modelId,
        name: body.name,
        description: body.description ?? null,
        created_by: actor,
        chart_dsl: body.chartDsl as object,
        semantic_query: body.semanticQuery as object,
        measure_snapshots: measureSnapshots as unknown as object[],
      },
    });

    return NextResponse.json({ chart }, { status: 201 });
  } catch (err) {
    console.error('[charts POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
