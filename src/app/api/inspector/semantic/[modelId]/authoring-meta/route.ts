import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/[modelId]/authoring-meta  (Phase 3.5B)
 *
 * Populates the "Define a Metric" form dropdowns. Unlike the /definitions
 * picker route this is NOT gated on the model being governed — authoring
 * happens against candidate models too, from inside the governance panel.
 *
 * Visibility rule (mirrors the authoring-access bypass): each entity/def is
 * returned iff it is NOT archived AND (status !== 'draft' OR created_by ===
 * caller). So the caller sees governed + candidate defs plus their OWN drafts —
 * never another user's draft.
 *
 * Per entity we return:
 *   - columns[]      — distinct physical column names known on the entity
 *                      (derived from its accessible dims + measures). Suggestions
 *                      for the Column field; the form also allows free text since
 *                      a new measure may target a not-yet-surfaced column.
 *   - dimensions[]   — for the preview "group by" selector
 *   - measures[]     — existing accessible measures (lets a dimension preview
 *                      pair with a measure so the chart is meaningful)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const org = await getDefaultOrg();
    const { modelId } = await params;

    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    const uid = currentUser.id;
    /** accessible = not archived, and not somebody else's draft. */
    const accessible = (row: { status: string; created_by: string | null }) =>
      row.status !== 'archived' && (row.status !== 'draft' || row.created_by === uid);

    const allEntities = await prisma.platform_sem_entities.findMany({
      where: { model_id: modelId, org_id: org.id },
      orderBy: { created_at: 'asc' },
    });
    const entities = allEntities.filter(accessible);
    const entityIds = entities.map((e) => e.id);

    const [dimensions, measures] = await Promise.all([
      prisma.platform_sem_dimensions.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id },
        orderBy: { created_at: 'asc' },
      }),
      prisma.platform_sem_measures.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id },
        orderBy: { created_at: 'asc' },
      }),
    ]);
    const accDims = dimensions.filter(accessible);
    const accMeasures = measures.filter(accessible);

    const dimsByEntity = new Map<string, typeof accDims>();
    for (const d of accDims) {
      const arr = dimsByEntity.get(d.entity_id) ?? [];
      arr.push(d);
      dimsByEntity.set(d.entity_id, arr);
    }
    const measuresByEntity = new Map<string, typeof accMeasures>();
    for (const m of accMeasures) {
      const arr = measuresByEntity.get(m.entity_id) ?? [];
      arr.push(m);
      measuresByEntity.set(m.entity_id, arr);
    }

    const entitiesOut = entities.map((e) => {
      const eDims = dimsByEntity.get(e.id) ?? [];
      const eMeasures = measuresByEntity.get(e.id) ?? [];
      const columns = Array.from(
        new Set<string>([
          ...eDims.map((d) => d.column_name).filter(Boolean),
          ...eMeasures.map((m) => m.column_name ?? '').filter(Boolean),
        ]),
      ).sort();
      return {
        id: e.id,
        entity_label: e.entity_label,
        full_path: e.full_path,
        status: e.status,
        columns,
        dimensions: eDims.map((d) => ({
          id: d.id,
          column_name: d.column_name,
          dimension_label: d.dimension_label,
          dimension_type: d.dimension_type,
          status: d.status,
        })),
        measures: eMeasures.map((m) => ({
          id: m.id,
          column_name: m.column_name,
          measure_label: m.measure_label,
          aggregate: m.aggregate,
          metric_type: m.metric_type,
          status: m.status,
        })),
      };
    });

    return NextResponse.json({
      model: { id: model.id, name: model.name, status: model.status },
      entities: entitiesOut,
    });
  } catch (err) {
    console.error('[semantic/authoring-meta GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
