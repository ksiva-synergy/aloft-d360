import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import {
  resolveGovernedModel,
  loadCatalog,
  scanConsumers,
  coReferencedMeasures,
  governanceSummary,
  measNodeId,
  dimNodeId,
  estateNodeId,
  type Omission,
} from '@/lib/semantic/lineage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/entities-catalog
 *
 * The Entities catalog surface. Governed-only lens: resolves the org's governed
 * model, then returns its entities (physical tables) with their dimensions +
 * measures grouped underneath, status-tagged (candidate | governed), classified
 * (synonyms / ai_context / dimension_type), and cross-linked to the metrics and
 * dashboards that consume them (Pin #2 reverse read).
 *
 * NOT included here: example values + distinct-value cardinality — those require
 * a live Databricks DISTINCT read through the executeDatabricksSQL chokepoint and
 * are surfaced on-demand, not baked into this metadata endpoint (see Pin #1 recon).
 *
 * Paginated + searchable — the populated model has ~700 entities, so the whole
 * catalog is never shipped at once. `q` filters entities by label / full_path;
 * `limit` (default 40, max 100) + `offset` page the result.
 *
 * States (never a 500 for the no-model case):
 *   { status: 'no_governed_model' }  — nothing governed yet (explicit UX state)
 *   { status: 'ok', model, entities, total, hasMore, dimensionTypes }
 */
export async function GET(request: NextRequest) {
  try {
    // ── Read gate: authenticated org member (governed defs are org-level catalog) ──
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getUserByEmail(email);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const org = await getDefaultOrg();

    const model = await resolveGovernedModel(org.id);
    if (!model) {
      return NextResponse.json({ status: 'no_governed_model' as const });
    }

    const cat = await loadCatalog(org.id, model.id);
    if (!cat) {
      return NextResponse.json({ status: 'no_governed_model' as const });
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 40, 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

    // Filter + page the entities BEFORE building children (bounds the payload).
    const matchedEntities = q
      ? cat.entities.filter(
          (e) => e.entity_label.toLowerCase().includes(q) || e.full_path.toLowerCase().includes(q),
        )
      : cat.entities;
    const total = matchedEntities.length;
    const pageEntities = matchedEntities.slice(offset, offset + limit);
    const pageEntityIds = new Set(pageEntities.map((e) => e.id));

    const consumers = await scanConsumers(org.id);

    // Map each def id → the dashboards that reference it (forward consumer read).
    const dashboardsFor = (kind: 'dim' | 'meas', id: string) =>
      consumers
        .filter((c) => (kind === 'dim' ? c.dimensionIds.has(id) : c.measureIds.has(id)))
        .map((c) => ({ dashboardId: c.dashboardId, name: c.name, modelGoverned: c.modelGoverned }));

    const measureLabelById = new Map(cat.measures.map((m) => [m.id, m.measure_label]));

    const dimsByEntity = new Map<string, typeof cat.dimensions>();
    for (const d of cat.dimensions) {
      if (!pageEntityIds.has(d.entity_id)) continue; // only build children for the page
      const arr = dimsByEntity.get(d.entity_id) ?? [];
      arr.push(d);
      dimsByEntity.set(d.entity_id, arr);
    }
    const measByEntity = new Map<string, typeof cat.measures>();
    for (const m of cat.measures) {
      if (!pageEntityIds.has(m.entity_id)) continue;
      const arr = measByEntity.get(m.entity_id) ?? [];
      arr.push(m);
      measByEntity.set(m.entity_id, arr);
    }

    const entities = pageEntities.map((e) => ({
      id: e.id,
      nodeId: estateNodeId(e.id),
      label: e.entity_label,
      fullPath: e.full_path,
      status: e.status,
      description: e.description,
      dimensions: (dimsByEntity.get(e.id) ?? []).map((d) => {
        // reverse lens (Pin #2): metrics that use this dimension = measures
        // co-referenced with it in any consuming widget.
        const usedByMeasureIds = [...coReferencedMeasures(d.id, consumers)];
        return {
          id: d.id,
          nodeId: dimNodeId(d.id),
          label: d.dimension_label,
          status: d.status,
          dimensionType: d.dimension_type,
          resolvesTo: { fullPath: e.full_path, column: d.column_name },
          classification: {
            synonyms: d.synonyms,
            aiContext: d.ai_context,
            description: d.description,
          },
          usedByMetrics: usedByMeasureIds
            .filter((mid) => measureLabelById.has(mid))
            .map((mid) => ({ measureId: mid, label: measureLabelById.get(mid)! })),
          consumers: dashboardsFor('dim', d.id),
        };
      }),
      measures: (measByEntity.get(e.id) ?? []).map((m) => ({
        id: m.id,
        nodeId: measNodeId(m.id),
        label: m.measure_label,
        status: m.status,
        metricType: m.metric_type,
        aggregate: m.aggregate,
        unit: m.unit,
        resolvesTo: { fullPath: e.full_path, column: m.column_name, expression: m.expression },
        classification: { synonyms: m.synonyms, aiContext: m.ai_context, description: m.description },
        consumers: dashboardsFor('meas', m.id),
      })),
    }));

    // Grouping key the UI can pivot on (the closest analog to the prototype's "type").
    const dimensionTypes = [...new Set(cat.dimensions.map((d) => d.dimension_type))].sort();

    return NextResponse.json({
      status: 'ok' as const,
      model,
      entities,
      total,
      hasMore: offset + limit < total,
      dimensionTypes,
      governance: governanceSummary(cat),
      // First-class contract absence (not just the prose note below): the fields
      // the catalog CANNOT resolve from stored metadata are named in the output.
      omissions: [
        {
          field: 'exampleValues',
          reason:
            'requires a live Databricks DISTINCT read through the executeDatabricksSQL ' +
            'chokepoint — surfaced on-demand, not baked into catalog metadata',
        },
        {
          field: 'cardinality',
          reason:
            'distinct-value counts require a live Databricks read through the ' +
            'executeDatabricksSQL chokepoint — not stored in platform_sem_* metadata',
        },
      ] satisfies Omission[],
      note:
        'Example values + distinct-value cardinality are not included here (they require a ' +
        'live Databricks read through the executeDatabricksSQL chokepoint).',
    });
  } catch (err) {
    console.error('[semantic/entities-catalog GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
