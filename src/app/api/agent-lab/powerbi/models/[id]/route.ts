import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { buildModelRecreationSummary } from '@/lib/powerbi/recreation-summary';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const orgId = await getOrgId();

    const model = await prisma.pbiModel.findFirst({
      where: { id, org_id: orgId, lifecycle: 'active' },
      include: {
        workspace: { select: { id: true, name: true, pbi_workspace_id: true } },
        domain: { select: { domain_key: true, name: true, rollout_wave: true } },
        tables: {
          where: { lifecycle: 'active', is_auto_date: false },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            partition_kind: true,
            storage_mode: true,
            hidden: true,
            sourceBinding: {
              select: {
                connector: true,
                connection_host: true,
                uc_full_path: true,
                bind_status: true,
                native_sql: true,
                context_object_id: true,
              },
            },
            _count: { select: { columns: true, measures: true } },
          },
        },
        measures: {
          orderBy: { name: 'asc' },
          take: 200,
          select: {
            id: true,
            name: true,
            table_id: true,
            display_folder: true,
            format_string: true,
            dax: true,
            table: { select: { name: true } },
          },
        },
        relationships: {
          take: 100,
          select: {
            id: true,
            pbi_relationship_id: true,
            from_column: true,
            to_column: true,
            cross_filtering: true,
            is_active: true,
          },
        },
        roles: { select: { id: true, name: true, filter_dax: true } },
        reports: {
          take: 50,
          select: { id: true, name: true, pbi_report_id: true, report_format: true, web_url: true },
        },
      },
    });

    if (!model) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const classification = (model.props as Record<string, unknown>)?.classification ?? null;
    const recreation = await buildModelRecreationSummary(orgId, model.id);
    const recreationByMeasureId = new Map(
      recreation.measures.map((r) => [r.measure_id, r]),
    );

    return NextResponse.json({
      recreation: recreation.summary,
      model: {
        id: model.id,
        pbi_model_id: model.pbi_model_id,
        name: model.name,
        description: model.description,
        workspace: model.workspace,
        rls_required: model.rls_required,
        storage_mode: model.storage_mode,
        classification,
        domain: model.domain,
        domain_assignment: (model.props as Record<string, unknown>)?.domain_assignment ?? null,
        parse: (model.props as Record<string, unknown>)?.parse ?? null,
        tables: model.tables.map((t) => ({
          id: t.id,
          name: t.name,
          partition_kind: t.partition_kind,
          storage_mode: t.storage_mode,
          hidden: t.hidden,
          column_count: t._count.columns,
          measure_count: t._count.measures,
          binding: t.sourceBinding,
        })),
        measures: model.measures.map((m) => {
          const rec = recreationByMeasureId.get(m.id);
          return {
            id: m.id,
            name: m.name,
            table_name: m.table.name,
            display_folder: m.display_folder,
            format_string: m.format_string,
            dax_preview: m.dax.length > 240 ? `${m.dax.slice(0, 240)}…` : m.dax,
            recreation_stage: rec?.stage ?? 'no_uc',
            recreation_reason: rec?.reason ?? null,
            translation_tier: rec?.translation_tier ?? null,
            parity_verdict: rec?.parity_verdict ?? null,
            verified_query_status: rec?.verified_query_status ?? null,
            uc_source_table: rec?.uc_source_table ?? null,
            column_resolution: rec?.column_resolution ?? null,
          };
        }),
        relationships: model.relationships,
        roles: model.roles.map((r) => ({
          id: r.id,
          name: r.name,
          filter_dax_preview: r.filter_dax
            ? r.filter_dax.length > 200
              ? `${r.filter_dax.slice(0, 200)}…`
              : r.filter_dax
            : null,
        })),
        reports: model.reports,
      },
    });
  } catch (err) {
    console.error('[powerbi/models/[id] GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
