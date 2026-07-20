import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createId } from '@paralleldrive/cuid2';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import prisma from '@/lib/db';
import { computeMeasureSnapshots } from '@/lib/dashboards/governance';
import { enforceReadOnly } from '@/lib/databricks/execute';
import { resolveToolCatalogEntry } from '@/lib/inspector/tools';
import { upsertIntentEmbedding } from '@/lib/semantic/intent-embed';
import type { RawSqlChartDsl } from '@/lib/dashboards/raw-sql-chart';
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
    // Best-effort author resolution so saved charts attribute to the real user
    // (the "What I've taught" view + intent-embedding ownership depend on this).
    // Falls back to the client-supplied createdBy, then 'system'.
    let sessionUserId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      const email = session?.user?.email ?? null;
      const u = email ? await getUserByEmail(email) : null;
      sessionUserId = u?.id ?? null;
    } catch { /* anonymous / service caller */ }
    const body = await request.json() as {
      chartSource?: 'semantic' | 'raw_sql';
      modelId?: string;
      name: string;
      description?: string;
      chartDsl: ChartDSLSpec | RawSqlChartDsl;
      semanticQuery?: SemanticQuery;
      createdBy?: string;
      // ── raw_sql fields (Phase 3.5C) ──
      rawSql?: string;
      resultSchema?: { name: string; type: string }[];
      nlIntent?: string;
      connectionId?: string;
    };

    // ── Phase 3.5C: raw-SQL escape-hatch save ──────────────────────────────────
    // A raw-SQL chart is durable but explicitly ungoverned: no model, no
    // semanticQuery, no measure_snapshots. enforceReadOnly runs HERE, at save —
    // a mutating/malformed statement is rejected (400) and never persisted.
    if (body.chartSource === 'raw_sql') {
      if (!body.name || !body.chartDsl || !body.rawSql) {
        return NextResponse.json(
          { error: 'name, chartDsl, and rawSql are required for a raw-SQL chart' },
          { status: 400 },
        );
      }

      try {
        enforceReadOnly(body.rawSql);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'SQL is not read-only' },
          { status: 400 },
        );
      }

      // Resolve the warehouse connection the same way Inspector chat does
      // (tool_catalog → config.connection_id). The client doesn't know it; the
      // ad-hoc SQL ran against this same connection server-side.
      let connectionId = body.connectionId ?? null;
      if (!connectionId) {
        const catalog = await resolveToolCatalogEntry('');
        connectionId = (catalog?.config?.connection_id as string | undefined) ?? null;
      }
      if (!connectionId) {
        return NextResponse.json(
          { error: 'No Databricks connection available to bind this raw-SQL chart' },
          { status: 400 },
        );
      }

      const rawId = createId();
      const rawAuthor = sessionUserId ?? body.createdBy ?? 'system';
      const chart = await prisma.platform_charts.create({
        data: {
          id: rawId,
          org_id: org.id,
          model_id: null,
          name: body.name,
          description: body.description ?? null,
          created_by: rawAuthor,
          chart_dsl: body.chartDsl as object,
          semantic_query: undefined,
          measure_snapshots: [] as unknown as object[],
          chart_source: 'raw_sql',
          raw_sql: body.rawSql,
          result_schema: (body.resultSchema ?? []) as unknown as object,
          nl_intent: body.nlIntent ?? null,
          connection_id: connectionId,
        },
      });

      // Embed the intent (non-fatal) so this saved question can rank in
      // disambiguation/matching for its author and in candidate-scoped contexts.
      if (chart.nl_intent) {
        await upsertIntentEmbedding({
          orgId: org.id,
          sourceType: 'raw_chart',
          sourceId: rawId,
          intentText: chart.nl_intent,
          modelId: null,
          createdBy: sessionUserId ?? null,
        });
      }

      return NextResponse.json({ chart }, { status: 201 });
    }

    // ── Semantic save (unchanged) ──────────────────────────────────────────────
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
    const actor = sessionUserId ?? body.createdBy ?? 'system';

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
