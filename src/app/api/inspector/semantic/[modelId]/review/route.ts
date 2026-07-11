import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/[modelId]/review
 *
 * Returns the full candidate model with all entities + their
 * dimensions, measures, and joins — used by SemanticGovernancePanel.
 *
 * Response: { model: { id, name, status }, entities: [...] }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { modelId } = await params;

    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    const entities = await prisma.platform_sem_entities.findMany({
      where: { model_id: modelId, org_id: org.id },
      orderBy: { created_at: 'asc' },
    });

    const entityIds = entities.map((e) => e.id);

    const [dimensions, measures, joins] = await Promise.all([
      prisma.platform_sem_dimensions.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id },
        orderBy: { created_at: 'asc' },
      }),
      prisma.platform_sem_measures.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id },
        orderBy: { created_at: 'asc' },
      }),
      prisma.platform_sem_joins.findMany({
        where: { model_id: modelId, org_id: org.id },
        orderBy: { created_at: 'asc' },
      }),
    ]);

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
    const joinsByEntity = new Map<string, typeof joins>();
    for (const j of joins) {
      const arr = joinsByEntity.get(j.from_entity_id) ?? [];
      arr.push(j);
      joinsByEntity.set(j.from_entity_id, arr);
    }

    const entitiesWithChildren = entities.map((e) => ({
      ...e,
      dimensions: dimsByEntity.get(e.id) ?? [],
      measures: measuresByEntity.get(e.id) ?? [],
      joins: joinsByEntity.get(e.id) ?? [],
    }));

    return NextResponse.json({
      model: { id: model.id, name: model.name, status: model.status },
      entities: entitiesWithChildren,
    });
  } catch (err) {
    console.error('[semantic/review GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
