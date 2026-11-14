import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { incrementalRefreshWindow, readMParameters } from '@/lib/powerbi/m-parameters';
import { PBI_PARSER_VERSION } from '@/lib/powerbi/parse';
import { readModelExpressions } from '@/lib/powerbi/source-origin';
import type { TmdlColumnMeta, TmdlMeasureMeta, TmdlTableMeta } from '@/lib/powerbi/tmdl-parse';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export type ModelDefinitionResponse = {
  /** Parsed with the current parser (else: run the pipeline with Parse to capture everything). */
  complete: boolean;
  settings: {
    culture: string | null;
    sourceQueryCulture: string | null;
    compatibilityLevel: number | null;
    timeIntelligenceEnabled: boolean | null;
    discourageImplicitMeasures: boolean;
    dataAccessOptions: string[];
  } | null;
  parameters: { name: string; value: string }[];
  roles: {
    name: string;
    modelPermission: string | null;
    tablePermissions: { table: string; filter: string | null }[];
    members: number;
  }[];
  incrementalRefresh: {
    table: string;
    filterColumn: string | null;
    keeps: string;
    window: { start: string; end: string } | null;
  }[];
  relationships: { from: string; to: string; cardinality: string; crossFiltering: string | null; active: boolean }[];
  hierarchies: { table: string; name: string; levels: string[] }[];
  fieldParameters: string[];
  dynamicFormatMeasures: { measure: string; expression: string }[];
  quickMeasures: { measure: string; template: string }[];
  hidden: { tables: number; columns: number; measures: number };
  described: { tables: number; columns: number; measures: number };
  dataCategories: Record<string, number>;
  synonyms: { culture: string | null; objects: number; authored: number; examples: { object: string; terms: string[] }[] } | null;
  unhandled: Record<string, number>;
};

const isAutoDate = (name: string) => /^(LocalDateTable_|DateTableTemplate_)/i.test(name);

/** Everything the model definition (TMDL) says beyond tables, columns and measures. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const orgId = await getOrgId();
    const model = await prisma.pbiModel.findFirst({
      where: { id, org_id: orgId, lifecycle: 'active' },
      select: {
        props: true,
        last_refresh_at: true,
        tables: { where: { lifecycle: 'active' }, select: { name: true, hidden: true, source_m: true, props: true } },
        columns: { where: { lifecycle: 'active' }, select: { name: true, props: true, table: { select: { name: true } } } },
        measures: { select: { name: true, props: true } },
        relationships: { where: { lifecycle: 'active' }, select: { from_column: true, to_column: true, cardinality: true, cross_filtering: true, is_active: true } },
        roles: { where: { lifecycle: 'active' }, select: { name: true, filter_dax: true, props: true } },
      },
    });
    if (!model) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const props = (model.props ?? {}) as Record<string, unknown>;
    const parse = props.parse as { parser_version?: string } | undefined;
    const def = (props.model_definition ?? null) as Record<string, unknown> | null;
    const refreshedAt = model.last_refresh_at ?? new Date();

    const tmdlOf = <T,>(p: unknown) => ((p as { tmdl?: T } | null)?.tmdl ?? null) as T | null;
    const userTables = model.tables.filter((t) => !isAutoDate(t.name));

    const incrementalRefresh: ModelDefinitionResponse['incrementalRefresh'] = [];
    const hierarchies: ModelDefinitionResponse['hierarchies'] = [];
    const fieldParameters: string[] = [];
    let describedTables = 0;
    for (const t of userTables) {
      const meta = tmdlOf<TmdlTableMeta>(t.props);
      if (meta?.description) describedTables++;
      if (meta?.fieldParameter) fieldParameters.push(t.name);
      for (const h of meta?.hierarchies ?? []) hierarchies.push({ table: t.name, name: h.name, levels: h.levels.map((l) => l.name) });
      const rp = meta?.refreshPolicy;
      if (rp) {
        const w = incrementalRefreshWindow(rp, refreshedAt);
        const col = (t.source_m ?? rp.sourceExpression ?? '').match(/\[([^\]]+)\]\s*>=?\s*RangeStart/)?.[1] ?? null;
        incrementalRefresh.push({
          table: t.name,
          filterColumn: col,
          keeps: `${rp.rollingWindowPeriods ?? '?'} ${rp.rollingWindowGranularity ?? ''}(s) archived + ${rp.incrementalPeriods ?? '?'} ${rp.incrementalGranularity ?? ''}(s) refreshed`,
          window: w ? { start: w.start.toISOString().slice(0, 10), end: w.end.toISOString().slice(0, 10) } : null,
        });
      }
    }

    let hiddenColumns = 0;
    let describedColumns = 0;
    const dataCategories: Record<string, number> = {};
    for (const c of model.columns) {
      if (isAutoDate(c.table.name)) continue;
      const meta = tmdlOf<TmdlColumnMeta>(c.props);
      if (meta?.hidden) hiddenColumns++;
      if (meta?.description) describedColumns++;
      const cat = meta?.properties?.dataCategory;
      if (cat) dataCategories[cat] = (dataCategories[cat] ?? 0) + 1;
    }

    let hiddenMeasures = 0;
    let describedMeasures = 0;
    const dynamicFormatMeasures: ModelDefinitionResponse['dynamicFormatMeasures'] = [];
    const quickMeasures: ModelDefinitionResponse['quickMeasures'] = [];
    for (const m of model.measures) {
      const meta = tmdlOf<TmdlMeasureMeta>(m.props);
      if (meta?.hidden) hiddenMeasures++;
      if (meta?.description) describedMeasures++;
      if (meta?.formatStringDefinition) dynamicFormatMeasures.push({ measure: m.name, expression: meta.formatStringDefinition.slice(0, 200) });
      const tpl = meta?.extendedProperties?.MeasureTemplate;
      if (tpl) {
        let template = 'quick measure';
        try {
          template = (JSON.parse(tpl) as { daxTemplateName?: string }).daxTemplateName ?? template;
        } catch {
          /* keep the generic label */
        }
        quickMeasures.push({ measure: m.name, template });
      }
    }

    const syn = props.synonyms as { culture: string | null; entries: Record<string, string[]>; authored: number } | null | undefined;
    const body: ModelDefinitionResponse = {
      complete: parse?.parser_version === PBI_PARSER_VERSION,
      settings: def
        ? {
            culture: (def.culture as string) ?? null,
            sourceQueryCulture: (def.sourceQueryCulture as string) ?? null,
            compatibilityLevel: (def.compatibilityLevel as number) ?? null,
            timeIntelligenceEnabled: (def.timeIntelligenceEnabled as boolean | null) ?? null,
            discourageImplicitMeasures: Boolean(def.discourageImplicitMeasures),
            dataAccessOptions: (def.dataAccessOptions as string[]) ?? [],
          }
        : null,
      parameters: Object.entries(readMParameters(readModelExpressions(model.props))).map(([name, value]) => ({ name, value })),
      roles: model.roles.map((r) => {
        const p = (r.props ?? {}) as { model_permission?: string; table_permissions?: { table: string; filter: string | null }[]; members?: unknown[] };
        return {
          name: r.name,
          modelPermission: p.model_permission ?? null,
          tablePermissions: p.table_permissions ?? (r.filter_dax ? [{ table: '', filter: r.filter_dax }] : []),
          members: p.members?.length ?? 0,
        };
      }),
      incrementalRefresh,
      relationships: model.relationships
        .filter((r) => (r.cardinality && r.cardinality !== 'many_to_one') || r.cross_filtering === 'bothDirections' || r.is_active === false)
        .map((r) => ({
          from: r.from_column ?? '?',
          to: r.to_column ?? '?',
          cardinality: r.cardinality ?? 'many_to_one',
          crossFiltering: r.cross_filtering,
          active: r.is_active !== false,
        })),
      hierarchies,
      fieldParameters,
      dynamicFormatMeasures,
      quickMeasures,
      hidden: { tables: userTables.filter((t) => t.hidden).length, columns: hiddenColumns, measures: hiddenMeasures },
      described: { tables: describedTables, columns: describedColumns, measures: describedMeasures },
      dataCategories,
      synonyms: syn
        ? {
            culture: syn.culture,
            objects: Object.keys(syn.entries ?? {}).length,
            authored: syn.authored ?? 0,
            examples: Object.entries(syn.entries ?? {})
              .filter(([, terms]) => terms.length > 1)
              .slice(0, 5)
              .map(([object, terms]) => ({ object, terms: terms.slice(0, 5) })),
          }
        : null,
      unhandled: (props.tmdl_unhandled as Record<string, number>) ?? {},
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error('[powerbi/models/definition]', e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
