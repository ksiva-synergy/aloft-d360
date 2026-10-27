import 'server-only';
import prisma from '@/lib/db';
import { createId } from '@paralleldrive/cuid2';
import { loadObjectT2Context, type ObjectT2Context } from './context-loader';

function humanizeTableName(objectName: string): string {
  return objectName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function entityLabelFromContext(ctx: ObjectT2Context): string {
  const card = ctx.card;
  const entity = typeof card?.entity === 'string' ? card.entity.trim() : '';
  if (entity) {
    return entity.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  if (ctx.object_name) return humanizeTableName(ctx.object_name);
  return ctx.full_path.split('.').pop() ?? 'Entity';
}

function descriptionFromContext(ctx: ObjectT2Context): string | null {
  const summary = ctx.card?.summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
}

function resolveTargetPath(
  likelyTarget: string,
  byPath: Map<string, string>,
  catalog: string,
  schema: string,
): string | null {
  const t = likelyTarget.trim();
  if (byPath.has(t)) return t;
  const qualified = `${catalog}.${schema}.${t.split('.').pop()}`;
  if (byPath.has(qualified)) return qualified;
  const twoPart = t.includes('.') ? t : `${schema}.${t}`;
  if (byPath.has(twoPart)) return twoPart;
  const threePart = twoPart.includes('.') && !twoPart.startsWith(`${catalog}.`)
    ? `${catalog}.${twoPart}`
    : twoPart;
  if (byPath.has(threePart)) return threePart;
  return null;
}

export async function proposeEntitiesAndJoinsForCluster(
  orgId: string,
  modelId: string,
  objectIds: string[],
  catalog: string,
  schema: string,
): Promise<{ entities_proposed: number; joins_proposed: number; pathToEntityId: Map<string, string> }> {
  const contexts: ObjectT2Context[] = [];
  for (const id of objectIds) {
    const ctx = await loadObjectT2Context(id);
    if (ctx) contexts.push(ctx);
  }

  const pathToEntityId = new Map<string, string>();
  let entitiesProposed = 0;

  for (const ctx of contexts) {
    const label = entityLabelFromContext(ctx);
    const description = descriptionFromContext(ctx);
    const existing = await prisma.platform_sem_entities.findFirst({
      where: { model_id: modelId, full_path: ctx.full_path },
      select: { id: true },
    });
    const entityId = existing?.id ?? createId();
    if (existing) {
      await prisma.platform_sem_entities.update({
        where: { id: entityId },
        data: {
          entity_label: label,
          description,
          updated_at: new Date(),
          status: 'candidate',
        },
      });
    } else {
      await prisma.platform_sem_entities.create({
        data: {
          id: entityId,
          org_id: orgId,
          model_id: modelId,
          full_path: ctx.full_path,
          entity_label: label,
          description,
          status: 'candidate',
          created_by: null,
        },
      });
      entitiesProposed++;
    }
    pathToEntityId.set(ctx.full_path, entityId);
  }

  let joinsProposed = 0;
  const seenJoins = new Set<string>();

  for (const ctx of contexts) {
    const fromId = pathToEntityId.get(ctx.full_path);
    if (!fromId) continue;
    const fkCandidates = Array.isArray(ctx.card?.fk_candidates) ? ctx.card!.fk_candidates : [];
    for (const raw of fkCandidates) {
      if (!raw || typeof raw !== 'object') continue;
      const col = typeof (raw as { column?: string }).column === 'string'
        ? (raw as { column: string }).column
        : null;
      const target = typeof (raw as { likely_target?: string }).likely_target === 'string'
        ? (raw as { likely_target: string }).likely_target
        : null;
      if (!col || !target) continue;
      const targetPath = resolveTargetPath(target, pathToEntityId, catalog, schema);
      if (!targetPath) continue;
      const toId = pathToEntityId.get(targetPath);
      if (!toId || toId === fromId) continue;
      const joinKey = [fromId, toId].sort().join('|');
      if (seenJoins.has(joinKey)) continue;
      seenJoins.add(joinKey);

      const existingJoin = await prisma.platform_sem_joins.findFirst({
        where: {
          OR: [
            { from_entity_id: fromId, to_entity_id: toId },
            { from_entity_id: toId, to_entity_id: fromId },
          ],
        },
      });
      if (existingJoin) continue;

      await prisma.platform_sem_joins.create({
        data: {
          id: createId(),
          org_id: orgId,
          model_id: modelId,
          from_entity_id: fromId,
          to_entity_id: toId,
          join_type: 'inner',
          join_on_sql: `${ctx.full_path}.${col} = ${targetPath}.id`,
          description: 'Proposed from T2 FK hints',
        },
      });
      joinsProposed++;
    }
  }

  return { entities_proposed: entitiesProposed, joins_proposed: joinsProposed, pathToEntityId };
}
