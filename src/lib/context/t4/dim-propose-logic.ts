import 'server-only';
import prisma from '@/lib/db';
import { createId } from '@paralleldrive/cuid2';
import { loadObjectT2Context } from './context-loader';

const MEASURE_ROLES = new Set(['measure']);
const DIMENSION_ROLES = new Set(['key', 'dimension', 'timestamp', 'audit', 'text_blob', 'fk_ref', 'flag', 'other']);

function dimensionTypeForRole(role: string): string {
  if (role === 'timestamp') return 'temporal';
  if (role === 'key' || role === 'fk_ref') return 'identifier';
  return 'categorical';
}

function labelFromColumn(name: string, semantic: Record<string, unknown> | null): string {
  const desc = typeof semantic?.description === 'string' ? semantic.description.trim() : '';
  if (desc) return desc;
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function proposeDimensionsAndMeasures(
  orgId: string,
  modelId: string,
  contextObjectId: string,
): Promise<{ dimensions_written: number; measures_written: number }> {
  const ctx = await loadObjectT2Context(contextObjectId);
  if (!ctx) {
    return { dimensions_written: 0, measures_written: 0 };
  }

  const entity = await prisma.platform_sem_entities.findFirst({
    where: { org_id: orgId, model_id: modelId, full_path: ctx.full_path },
    select: { id: true },
  });
  if (!entity) {
    return { dimensions_written: 0, measures_written: 0 };
  }

  const cardMeasures = Array.isArray(ctx.card?.measures)
    ? (ctx.card!.measures as string[])
    : [];

  let dimensionsWritten = 0;
  let measuresWritten = 0;
  const now = new Date();

  for (const col of ctx.columns) {
    const sem = col.semantic ?? {};
    const role = typeof sem.role === 'string' ? sem.role : 'other';
    const label = labelFromColumn(col.name, sem);
    const description =
      typeof sem.description === 'string' && sem.description.trim() ? sem.description.trim() : null;

    const isMeasure = MEASURE_ROLES.has(role) || cardMeasures.includes(col.name);

    if (isMeasure) {
      const existing = await prisma.platform_sem_measures.findFirst({
        where: { entity_id: entity.id, column_name: col.name },
      });
      if (existing) {
        await prisma.platform_sem_measures.update({
          where: { id: existing.id },
          data: {
            measure_label: label,
            description,
            aggregate: existing.aggregate ?? 'sum',
            updated_at: now,
            status: 'candidate',
          },
        });
      } else {
        await prisma.platform_sem_measures.create({
          data: {
            id: createId(),
            org_id: orgId,
            entity_id: entity.id,
            column_name: col.name,
            measure_label: label,
            description,
            aggregate: 'sum',
            metric_type: 'simple',
            status: 'candidate',
            created_by: null,
          },
        });
        measuresWritten++;
      }
      continue;
    }

    if (!DIMENSION_ROLES.has(role)) continue;

    const existingDim = await prisma.platform_sem_dimensions.findFirst({
      where: { entity_id: entity.id, column_name: col.name },
    });
    if (existingDim) {
      await prisma.platform_sem_dimensions.update({
        where: { id: existingDim.id },
        data: {
          dimension_label: label,
          description,
          dimension_type: dimensionTypeForRole(role),
          updated_at: now,
          status: 'candidate',
        },
      });
    } else {
      await prisma.platform_sem_dimensions.create({
        data: {
          id: createId(),
          org_id: orgId,
          entity_id: entity.id,
          column_name: col.name,
          dimension_label: label,
          description,
          dimension_type: dimensionTypeForRole(role),
          status: 'candidate',
          created_by: null,
        },
      });
      dimensionsWritten++;
    }
  }

  await prisma.platformContextObject.update({
    where: { id: contextObjectId },
    data: { last_t4_at: now },
  });

  return { dimensions_written: dimensionsWritten, measures_written: measuresWritten };
}
