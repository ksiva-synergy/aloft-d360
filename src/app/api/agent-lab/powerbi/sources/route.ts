import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import {
  SOURCE_CATEGORIES,
  modelSourceRefs,
  refKeys,
  sourceTypeCategory,
  sourceTypeLabel,
  type ServiceDatasource,
  type SourceCategory,
  type SourceType,
} from '@/lib/powerbi/estate-sources';
import { readModelExpressions } from '@/lib/powerbi/source-origin';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

export type EstateSourcesResponse = {
  categories: { id: SourceCategory; label: string }[];
  types: { key: string; id: SourceType; label: string; category: SourceCategory }[];
  /** Specific server / host / site / folder. `key` is `inst:<type>|<instance>`. */
  instances: { key: string; type: SourceType; label: string; title: string }[];
  /** Database / catalog inside an instance. `key` is `db:<type>|<instance>|<database>`. */
  databases: { key: string; type: SourceType; instance: string | null; label: string }[];
  /** model id → filter keys (`cat:`, `type:`, `inst:`, `db:`) of every source it reads. */
  by_model: Record<string, string[]>;
};

type TableRow = { name: string; source_m: string | null; partition_kind: string | null };

/**
 * Specific sources per active model, classified category → type → server/site → database, for
 * the estate "Source" filter. Merges the Power BI service datasource list with Power Query.
 */
export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const [models, tables, datasources] = await Promise.all([
      prisma.$queryRaw<{ id: string; expressions: unknown }[]>`
        SELECT id::text AS id, props->'expressions' AS expressions
        FROM pbi_models
        WHERE org_id = ${orgId} AND lifecycle = 'active'`,
      prisma.pbiTable.findMany({
        where: { org_id: orgId, lifecycle: 'active', is_auto_date: false, model: { lifecycle: 'active' } },
        select: { model_id: true, name: true, source_m: true, partition_kind: true },
      }),
      prisma.pbiModelDatasource.findMany({
        where: { org_id: orgId, model: { lifecycle: 'active' } },
        select: { model_id: true, datasource_type: true, connection_server: true, connection_path: true, raw: true },
      }),
    ]);

    const group = <T extends { model_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) {
        const list = m.get(r.model_id) ?? [];
        list.push(r);
        m.set(r.model_id, list);
      }
      return m;
    };
    const tablesByModel = group<TableRow & { model_id: string }>(tables);
    const dsByModel = group<ServiceDatasource & { model_id: string }>(datasources);

    const types = new Map<string, EstateSourcesResponse['types'][number]>();
    const instances = new Map<string, EstateSourcesResponse['instances'][number]>();
    const databases = new Map<string, EstateSourcesResponse['databases'][number]>();
    const byModel: Record<string, string[]> = {};

    for (const m of models) {
      const refs = modelSourceRefs({
        datasources: dsByModel.get(m.id) ?? [],
        expressions: readModelExpressions({ expressions: m.expressions }),
        tables: tablesByModel.get(m.id) ?? [],
      });
      if (!refs.length) continue;
      const keys = new Set<string>();
      for (const r of refs) {
        for (const k of refKeys(r)) keys.add(k);
        const typeKey = `type:${r.type}`;
        if (!types.has(typeKey)) {
          types.set(typeKey, { key: typeKey, id: r.type, label: sourceTypeLabel(r.type), category: sourceTypeCategory(r.type) });
        }
        const instKey = r.instance ? `inst:${r.type}|${r.instance.key}` : null;
        if (instKey && !instances.has(instKey)) {
          instances.set(instKey, { key: instKey, type: r.type, label: r.instance!.label, title: r.instance!.title });
        }
        if (r.database) {
          const dbKey = `db:${r.type}|${r.instance?.key ?? ''}|${r.database.key}`;
          if (!databases.has(dbKey)) databases.set(dbKey, { key: dbKey, type: r.type, instance: instKey, label: r.database.label });
        }
      }
      byModel[m.id] = [...keys];
    }

    const body: EstateSourcesResponse = {
      categories: SOURCE_CATEGORIES,
      types: [...types.values()],
      instances: [...instances.values()].sort((a, b) => a.label.localeCompare(b.label)),
      databases: [...databases.values()].sort((a, b) => a.label.localeCompare(b.label)),
      by_model: byModel,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[powerbi/sources GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
