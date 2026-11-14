import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { buildFidelityReport } from '@/lib/powerbi/fidelity-gate';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import {
  buildQueryMap,
  describeOrigin,
  describeSourceOrigins,
  emptyOrigin,
  originClass,
  originTitle,
  readModelExpressions,
  type OriginClass,
  type SourceOrigin,
} from '@/lib/powerbi/source-origin';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export type ModelSourceGroup = {
  key: string;
  class: OriginClass;
  title: string;
  description: string;
  origin: SourceOrigin;
  tables: {
    name: string;
    partition_kind: string | null;
    bind_status: string | null;
    uc_full_path: string | null;
    context_object_id: string | null;
  }[];
  /** Measures that cannot be recreated because they read this source (fidelity gate). */
  blocked_measures: number;
};

export type ModelSourcesResponse = {
  sources: ModelSourceGroup[];
  measures_total: number;
  /** Measures blocked because a table they read is not in the warehouse. */
  measures_outside_warehouse: number;
  /** Shared expressions were captured at parse time (helper queries followed). */
  helper_queries: number;
};

const groupKey = (o: SourceOrigin) =>
  [o.system, o.format, o.location?.toLowerCase(), o.file?.toLowerCase(), o.database?.toLowerCase(), o.object?.toLowerCase()].join('|');

/** Where each table's data comes from (Power Query traced through helper queries), grouped by source. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const orgId = await getOrgId();
    const model = await prisma.pbiModel.findFirst({
      where: { id, org_id: orgId, lifecycle: 'active' },
      select: {
        id: true,
        props: true,
        tables: {
          where: { lifecycle: 'active', is_auto_date: false },
          orderBy: { name: 'asc' },
          select: {
            name: true,
            source_m: true,
            partition_kind: true,
            sourceBinding: { select: { bind_status: true, uc_full_path: true, context_object_id: true } },
          },
        },
        _count: { select: { measures: true } },
      },
    });
    if (!model) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const expressions = readModelExpressions(model.props);
    const queries = buildQueryMap(expressions, model.tables);

    // Measures blocked per table by "source not in warehouse" (same gate the pipeline applies).
    const blockedByTable = new Map<string, Set<string>>();
    let outsideMeasures = new Set<string>();
    try {
      const catalog = await loadMeasureLogicCatalog(orgId, model.id);
      const report = buildFidelityReport(catalog);
      const idx = new Map<number, string>();
      report.issues.forEach((iss, i) => {
        if (iss.kind === 'source_not_in_warehouse' && iss.table) idx.set(i, iss.table);
      });
      for (const [measure, issues] of Object.entries(report.byMeasure)) {
        for (const i of issues) {
          const table = idx.get(i);
          if (!table) continue;
          outsideMeasures.add(measure);
          const set = blockedByTable.get(table) ?? new Set<string>();
          set.add(measure);
          blockedByTable.set(table, set);
        }
      }
    } catch (e) {
      console.warn('[powerbi/models/sources] fidelity check skipped', e);
      outsideMeasures = new Set();
    }

    const groups = new Map<string, ModelSourceGroup & { _measures: Set<string> }>();
    for (const t of model.tables) {
      const origins = describeSourceOrigins(t.source_m, queries, { partitionKind: t.partition_kind, selfName: t.name });
      for (const o of origins.length ? origins : [emptyOrigin('unknown')]) {
        const key = groupKey(o);
        let g = groups.get(key);
        if (!g) {
          g = {
            key,
            class: originClass(o),
            title: originTitle(o),
            description: describeOrigin(o),
            origin: o,
            tables: [],
            blocked_measures: 0,
            _measures: new Set(),
          };
          groups.set(key, g);
        } else if (o.items.length) {
          // the same file read for different sheets / tables
          const have = new Set(g.origin.items.map((i) => `${i.name}\0${i.kind}`));
          for (const it of o.items) if (!have.has(`${it.name}\0${it.kind}`)) g.origin.items.push(it);
          g.description = describeOrigin(g.origin);
        }
        g.tables.push({
          name: t.name,
          partition_kind: t.partition_kind,
          bind_status: t.sourceBinding?.bind_status ?? null,
          uc_full_path: t.sourceBinding?.uc_full_path ?? null,
          context_object_id: t.sourceBinding?.context_object_id ?? null,
        });
        for (const m of blockedByTable.get(t.name) ?? []) g._measures.add(m);
      }
    }

    const order: Record<OriginClass, number> = { file: 0, database: 1, warehouse: 2, unknown: 3, model: 4 };
    const sources = [...groups.values()]
      .map(({ _measures, ...g }) => ({ ...g, blocked_measures: _measures.size }))
      .sort((a, b) => order[a.class] - order[b.class] || b.tables.length - a.tables.length || a.title.localeCompare(b.title));

    const body: ModelSourcesResponse = {
      sources,
      measures_total: model._count.measures,
      measures_outside_warehouse: outsideMeasures.size,
      helper_queries: expressions.length,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error('[powerbi/models/sources]', e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
