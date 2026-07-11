import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/[modelId]/definitions
 *
 * Returns non-archived dimensions and measures grouped by entity,
 * for use by the D2 dashboard widget picker.
 *
 * Filtering rules (INSP-GOV hard prerequisite, Binding Correction 3):
 *  1. Model must be governed — non-governed models are not picker-eligible
 *  2. Entities are filtered to status != 'archived' FIRST — this scopes the
 *     entityIds used for dims/measures queries, so non-archived dims inside
 *     an archived entity cannot leak through
 *  3. Dimensions and measures are filtered to status != 'archived'
 *
 * The status field is included on every returned entity/dimension/measure so
 * D2's UI can visually distinguish 'governed' (domain-reviewed) from
 * 'candidate' (not yet reviewed). Both are shown; only 'archived' is excluded.
 *
 * Response shape:
 *   { model: { id, name }, entities: [{ ...entity, dimensions: [...], measures: [...] }] }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { modelId } = await params;

    // ── 1. Gate: model must be governed ──────────────────────────────────────
    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id, status: 'governed' },
    });
    if (!model) {
      return NextResponse.json(
        { error: 'Model not found or not governed' },
        { status: 404 },
      );
    }

    // ── 2. Entities — non-archived only ──────────────────────────────────────
    // Critical: compute entityIds from this filtered set before any dim/measure
    // queries. A non-archived dim inside an archived entity must not appear.
    const entities = await prisma.platform_sem_entities.findMany({
      where: { model_id: modelId, org_id: org.id, status: { not: 'archived' } },
      orderBy: { created_at: 'asc' },
    });
    const entityIds = entities.map((e) => e.id);

    // ── 3. Dimensions + measures — non-archived, scoped to active entities ───
    const [dimensions, measures] = await Promise.all([
      prisma.platform_sem_dimensions.findMany({
        where: {
          entity_id: { in: entityIds },
          org_id: org.id,
          status: { not: 'archived' },
        },
        orderBy: { created_at: 'asc' },
      }),
      prisma.platform_sem_measures.findMany({
        where: {
          entity_id: { in: entityIds },
          org_id: org.id,
          status: { not: 'archived' },
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    // ── Group by entity ───────────────────────────────────────────────────────
    const dimsByEntity = new Map<string, typeof dimensions>();
    for (const d of dimensions) {
      const arr = dimsByEntity.get(d.entity_id) ?? [];
      arr.push(d);
      dimsByEntity.set(d.entity_id, arr);
    }

    const measuresByEntity = new Map<string, typeof measures>();
    for (const m of measures) {
      const arr = measuresByEntity.get(m.entity_id) ?? [];
      arr.push(m);
      measuresByEntity.set(m.entity_id, arr);
    }

    const entitiesWithChildren = entities.map((e) => ({
      id: e.id,
      entity_label: e.entity_label,
      full_path: e.full_path,
      description: e.description,
      status: e.status,
      dimensions: (dimsByEntity.get(e.id) ?? []).map((d) => ({
        id: d.id,
        column_name: d.column_name,
        dimension_label: d.dimension_label,
        dimension_type: d.dimension_type,
        description: d.description,
        format_hint: d.format_hint,
        status: d.status,
      })),
      measures: (measuresByEntity.get(e.id) ?? []).map((m) => ({
        id: m.id,
        column_name: m.column_name,
        measure_label: m.measure_label,
        aggregate: m.aggregate,
        expression: m.expression,
        metric_type: m.metric_type,
        description: m.description,
        format_hint: m.format_hint,
        unit: m.unit,
        status: m.status,
      })),
    }));

    return NextResponse.json({
      model: { id: model.id, name: model.name },
      entities: entitiesWithChildren,
    });
  } catch (err) {
    console.error('[semantic/definitions GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
