import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/my-drafts  (W1 — standalone Metrics route)
 *
 * The org-aggregate sibling of /[modelId]/drafts: the caller's OWN draft
 * definitions (measures + dimensions) across EVERY semantic model in the org,
 * grouped by entity. Owner-scoped by construction — created_by === caller AND
 * status = 'draft' — exactly like the per-model route, minus the model narrowing.
 *
 * Each entity group carries its own `modelId` + `modelName` so the caller can
 * still route submit/delete mutations at the correct `/[modelId]/...` handler.
 * This is what lets a single MyDraftsSection render either one in-session model
 * or the whole org without a second component.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const org = await getDefaultOrg();
    const uid = currentUser.id;

    // OWNER-SCOPED across all models: only the caller's own drafts.
    const [dimensions, measures] = await Promise.all([
      prisma.platform_sem_dimensions.findMany({
        where: { org_id: org.id, status: 'draft', created_by: uid },
        orderBy: { created_at: 'asc' },
      }),
      prisma.platform_sem_measures.findMany({
        where: { org_id: org.id, status: 'draft', created_by: uid },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    const entityIds = [
      ...new Set([...dimensions.map((d) => d.entity_id), ...measures.map((m) => m.entity_id)]),
    ];
    if (entityIds.length === 0) {
      return NextResponse.json({ entities: [] });
    }

    // Resolve entity → model labels for grouping (scoped to the org).
    const entities = await prisma.platform_sem_entities.findMany({
      where: { id: { in: entityIds }, org_id: org.id },
      select: { id: true, entity_label: true, model_id: true },
    });
    const entityById = new Map(entities.map((e) => [e.id, e]));
    const modelIds = [...new Set(entities.map((e) => e.model_id))];
    const models = await prisma.platform_semantic_models.findMany({
      where: { id: { in: modelIds }, org_id: org.id },
      select: { id: true, name: true },
    });
    const modelNameById = new Map(models.map((m) => [m.id, m.name]));

    interface Group {
      modelId: string;
      modelName: string;
      entityId: string;
      entityLabel: string;
      dimensions: typeof dimensions;
      measures: typeof measures;
    }
    const groups = new Map<string, Group>();
    const ensure = (entityId: string): Group | null => {
      const e = entityById.get(entityId);
      if (!e) return null; // draft whose entity is not visible in-org — skip defensively
      let g = groups.get(entityId);
      if (!g) {
        g = {
          modelId: e.model_id,
          modelName: modelNameById.get(e.model_id) ?? e.model_id,
          entityId,
          entityLabel: e.entity_label ?? entityId,
          dimensions: [],
          measures: [],
        };
        groups.set(entityId, g);
      }
      return g;
    };
    for (const d of dimensions) ensure(d.entity_id)?.dimensions.push(d);
    for (const m of measures) ensure(m.entity_id)?.measures.push(m);

    const entitiesOut = [...groups.values()]
      .sort((a, b) => a.modelName.localeCompare(b.modelName) || a.entityLabel.localeCompare(b.entityLabel))
      .map((g) => ({
        modelId: g.modelId,
        modelName: g.modelName,
        entityId: g.entityId,
        entityLabel: g.entityLabel,
        dimensions: g.dimensions.map((d) => ({
          id: d.id,
          column_name: d.column_name,
          dimension_label: d.dimension_label,
          dimension_type: d.dimension_type,
          format_hint: d.format_hint,
          nl_intent: d.nl_intent,
          status: d.status,
        })),
        measures: g.measures.map((m) => ({
          id: m.id,
          column_name: m.column_name,
          measure_label: m.measure_label,
          aggregate: m.aggregate,
          metric_type: m.metric_type,
          expression: m.expression,
          unit: m.unit,
          format_hint: m.format_hint,
          nl_intent: m.nl_intent,
          status: m.status,
        })),
      }));

    return NextResponse.json({ entities: entitiesOut });
  } catch (err) {
    console.error('[semantic/my-drafts GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
