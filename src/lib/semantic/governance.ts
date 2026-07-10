/**
 * src/lib/semantic/governance.ts
 *
 * Shared helpers for the S3/S4 governance trust layer.
 * Used by the five governance API routes and the verify script.
 *
 * Exported:
 *   ALLOWED_EDIT_FIELDS    — per-tableKind field allowlists
 *   validateEditFields     — checks incoming fields against the allowlist
 *   writeAuditRow          — inserts one platform_sem_audit row
 *   recalculateModelStatus — recomputes model status after entity transitions
 *   promoteEntities        — sets entity status = 'governed', writes audit rows
 *   archiveEntities        — sets entity status = 'archived', writes audit rows
 *   promoteDefinitions     — sets dim/measure status = 'governed'; requires governed parent entity
 *   archiveDefinitions     — sets dim/measure status = 'archived'; no parent-entity constraint
 */

import { createId } from '@paralleldrive/cuid2';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/db';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TableKind = 'entity' | 'dimension' | 'measure';

export interface AuditRowParams {
  orgId: string;
  modelId: string;
  tableName: string;
  rowId: string;
  action: 'promote' | 'demote_archive' | 'edit';
  fromStatus?: string | null;
  toStatus?: string | null;
  changedBy?: string;
  diff?: { field: string; old: unknown; new: unknown }[] | null;
}

export interface FieldValidation {
  valid: boolean;
  rejected?: string;
}

// ── Allowlists ────────────────────────────────────────────────────────────────

export const ALLOWED_EDIT_FIELDS: Record<TableKind, Set<string>> = {
  entity: new Set(['entity_label', 'description', 'synonyms']),
  dimension: new Set(['dimension_label', 'dimension_type', 'description', 'synonyms', 'format_hint']),
  // column_name and entity_id are intentionally excluded — structural fields, not editable
  measure: new Set(['measure_label', 'aggregate', 'metric_type', 'expression', 'synonyms', 'format_hint', 'unit']),
};

// ── validateEditFields ────────────────────────────────────────────────────────

export function validateEditFields(
  tableKind: TableKind,
  fields: Record<string, unknown>,
): FieldValidation {
  const allowed = ALLOWED_EDIT_FIELDS[tableKind];
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) {
      return { valid: false, rejected: key };
    }
  }
  return { valid: true };
}

// ── writeAuditRow ─────────────────────────────────────────────────────────────

export async function writeAuditRow(params: AuditRowParams): Promise<void> {
  await prisma.platform_sem_audit.create({
    data: {
      id: createId(),
      org_id: params.orgId,
      model_id: params.modelId,
      table_name: params.tableName,
      row_id: params.rowId,
      action: params.action,
      from_status: params.fromStatus ?? null,
      to_status: params.toStatus ?? null,
      changed_by: params.changedBy ?? 'system',
      diff: params.diff
        ? (params.diff as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
  });
}

// ── recalculateModelStatus ────────────────────────────────────────────────────

/**
 * Recalculates platform_semantic_models.status after entity status changes.
 * Rules:
 *   - 'governed'  if any entity has status = 'governed'
 *   - 'candidate' otherwise (all entities are candidate or archived)
 * Does NOT set 'archived' on the model itself — model archiving is out of scope.
 */
export async function recalculateModelStatus(modelId: string, orgId: string): Promise<void> {
  const governedCount = await prisma.platform_sem_entities.count({
    where: { model_id: modelId, org_id: orgId, status: 'governed' },
  });
  const newStatus = governedCount > 0 ? 'governed' : 'candidate';
  await prisma.platform_semantic_models.updateMany({
    where: { id: modelId, org_id: orgId },
    data: { status: newStatus, updated_at: new Date() },
  });
}

// ── promoteEntities ───────────────────────────────────────────────────────────

export interface EntityTransitionResult {
  succeeded: string[];
  errors: { id: string; reason: string }[];
}

export async function promoteEntities(
  entityIds: string[],
  modelId: string,
  orgId: string,
): Promise<EntityTransitionResult> {
  const succeeded: string[] = [];
  const errors: { id: string; reason: string }[] = [];

  for (const entityId of entityIds) {
    const entity = await prisma.platform_sem_entities.findFirst({
      where: { id: entityId, model_id: modelId, org_id: orgId },
    });
    if (!entity) {
      errors.push({ id: entityId, reason: 'not found in this model' });
      continue;
    }
    if (entity.status === 'governed') {
      // Already governed — no-op, still counts as success
      succeeded.push(entityId);
      continue;
    }
    if (entity.status === 'archived') {
      errors.push({ id: entityId, reason: 'archived entities cannot be promoted' });
      continue;
    }
    await prisma.platform_sem_entities.updateMany({
      where: { id: entityId },
      data: { status: 'governed', updated_at: new Date() },
    });
    await writeAuditRow({
      orgId,
      modelId,
      tableName: 'platform_sem_entities',
      rowId: entityId,
      action: 'promote',
      fromStatus: entity.status,
      toStatus: 'governed',
    });
    succeeded.push(entityId);
  }

  if (succeeded.length > 0) {
    await recalculateModelStatus(modelId, orgId);
  }

  return { succeeded, errors };
}

// ── promoteDefinitions ────────────────────────────────────────────────────────

/**
 * Promotes individual dimensions or measures to 'governed'.
 *
 * Parent-entity guard: if the definition's parent entity is still 'candidate',
 * the definition is rejected with an explicit error — a governed definition
 * inside a candidate entity creates an ambiguous state for pickers.
 * Archive is unrestricted (see archiveDefinitions below).
 *
 * Does NOT call recalculateModelStatus — definition transitions never affect
 * model-level status (model status is entity-driven only).
 */
export async function promoteDefinitions(
  definitionIds: string[],
  tableKind: 'dimension' | 'measure',
  modelId: string,
  orgId: string,
): Promise<EntityTransitionResult> {
  const succeeded: string[] = [];
  const errors: { id: string; reason: string }[] = [];

  const tableName = tableKind === 'dimension'
    ? 'platform_sem_dimensions'
    : 'platform_sem_measures';

  for (const definitionId of definitionIds) {
    if (tableKind === 'dimension') {
      const def = await prisma.platform_sem_dimensions.findFirst({
        where: { id: definitionId, org_id: orgId },
        include: { platform_sem_entities: { select: { id: true, model_id: true, status: true } } },
      });
      if (!def || def.platform_sem_entities.model_id !== modelId) {
        errors.push({ id: definitionId, reason: 'not found in this model' });
        continue;
      }
      if (def.status === 'governed') {
        succeeded.push(definitionId);
        continue;
      }
      if (def.status === 'archived') {
        errors.push({ id: definitionId, reason: 'archived definitions cannot be promoted' });
        continue;
      }
      if (def.platform_sem_entities.status !== 'governed') {
        errors.push({
          id: definitionId,
          reason: `cannot promote definition ${definitionId} — parent entity ${def.platform_sem_entities.id} is not governed`,
        });
        continue;
      }
      await prisma.platform_sem_dimensions.updateMany({
        where: { id: definitionId },
        data: { status: 'governed', updated_at: new Date() },
      });
      await writeAuditRow({
        orgId,
        modelId,
        tableName,
        rowId: definitionId,
        action: 'promote',
        fromStatus: def.status,
        toStatus: 'governed',
      });
      succeeded.push(definitionId);
    } else {
      const def = await prisma.platform_sem_measures.findFirst({
        where: { id: definitionId, org_id: orgId },
        include: { platform_sem_entities: { select: { id: true, model_id: true, status: true } } },
      });
      if (!def || def.platform_sem_entities.model_id !== modelId) {
        errors.push({ id: definitionId, reason: 'not found in this model' });
        continue;
      }
      if (def.status === 'governed') {
        succeeded.push(definitionId);
        continue;
      }
      if (def.status === 'archived') {
        errors.push({ id: definitionId, reason: 'archived definitions cannot be promoted' });
        continue;
      }
      if (def.platform_sem_entities.status !== 'governed') {
        errors.push({
          id: definitionId,
          reason: `cannot promote definition ${definitionId} — parent entity ${def.platform_sem_entities.id} is not governed`,
        });
        continue;
      }
      await prisma.platform_sem_measures.updateMany({
        where: { id: definitionId },
        data: { status: 'governed', updated_at: new Date() },
      });
      await writeAuditRow({
        orgId,
        modelId,
        tableName,
        rowId: definitionId,
        action: 'promote',
        fromStatus: def.status,
        toStatus: 'governed',
      });
      succeeded.push(definitionId);
    }
  }

  return { succeeded, errors };
}

// ── archiveDefinitions ────────────────────────────────────────────────────────

/**
 * Archives individual dimensions or measures (status = 'archived').
 *
 * No parent-entity guard — archiving bad items from an ungoverned entity is
 * always valid. Already-archived definitions are a no-op success.
 *
 * Does NOT call recalculateModelStatus — definition transitions never affect
 * model-level status (model status is entity-driven only).
 */
export async function archiveDefinitions(
  definitionIds: string[],
  tableKind: 'dimension' | 'measure',
  modelId: string,
  orgId: string,
): Promise<EntityTransitionResult> {
  const succeeded: string[] = [];
  const errors: { id: string; reason: string }[] = [];

  const tableName = tableKind === 'dimension'
    ? 'platform_sem_dimensions'
    : 'platform_sem_measures';

  for (const definitionId of definitionIds) {
    if (tableKind === 'dimension') {
      const def = await prisma.platform_sem_dimensions.findFirst({
        where: { id: definitionId, org_id: orgId },
        include: { platform_sem_entities: { select: { model_id: true } } },
      });
      if (!def || def.platform_sem_entities.model_id !== modelId) {
        errors.push({ id: definitionId, reason: 'not found in this model' });
        continue;
      }
      if (def.status === 'archived') {
        succeeded.push(definitionId);
        continue;
      }
      await prisma.platform_sem_dimensions.updateMany({
        where: { id: definitionId },
        data: { status: 'archived', updated_at: new Date() },
      });
      await writeAuditRow({
        orgId,
        modelId,
        tableName,
        rowId: definitionId,
        action: 'demote_archive',
        fromStatus: def.status,
        toStatus: 'archived',
      });
      succeeded.push(definitionId);
    } else {
      const def = await prisma.platform_sem_measures.findFirst({
        where: { id: definitionId, org_id: orgId },
        include: { platform_sem_entities: { select: { model_id: true } } },
      });
      if (!def || def.platform_sem_entities.model_id !== modelId) {
        errors.push({ id: definitionId, reason: 'not found in this model' });
        continue;
      }
      if (def.status === 'archived') {
        succeeded.push(definitionId);
        continue;
      }
      await prisma.platform_sem_measures.updateMany({
        where: { id: definitionId },
        data: { status: 'archived', updated_at: new Date() },
      });
      await writeAuditRow({
        orgId,
        modelId,
        tableName,
        rowId: definitionId,
        action: 'demote_archive',
        fromStatus: def.status,
        toStatus: 'archived',
      });
      succeeded.push(definitionId);
    }
  }

  return { succeeded, errors };
}

// ── archiveEntities ───────────────────────────────────────────────────────────

export async function archiveEntities(
  entityIds: string[],
  modelId: string,
  orgId: string,
): Promise<EntityTransitionResult> {
  const succeeded: string[] = [];
  const errors: { id: string; reason: string }[] = [];

  for (const entityId of entityIds) {
    const entity = await prisma.platform_sem_entities.findFirst({
      where: { id: entityId, model_id: modelId, org_id: orgId },
    });
    if (!entity) {
      errors.push({ id: entityId, reason: 'not found in this model' });
      continue;
    }
    if (entity.status === 'archived') {
      succeeded.push(entityId);
      continue;
    }
    await prisma.platform_sem_entities.updateMany({
      where: { id: entityId },
      data: { status: 'archived', updated_at: new Date() },
    });
    await writeAuditRow({
      orgId,
      modelId,
      tableName: 'platform_sem_entities',
      rowId: entityId,
      action: 'demote_archive',
      fromStatus: entity.status,
      toStatus: 'archived',
    });
    succeeded.push(entityId);
  }

  if (succeeded.length > 0) {
    await recalculateModelStatus(modelId, orgId);
  }

  return { succeeded, errors };
}
