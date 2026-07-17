/**
 * src/lib/dashboards/governance.ts
 *
 * Server-side validation and snapshot helpers for dashboard version saves.
 *
 * Two responsibilities:
 *  1. validateWidgetReferences — cross-model reference guard (save-time)
 *  2. computeMeasureSnapshots — freeze computation fields for drift detection
 *
 * Both are called by the version-create route before any INSERT.
 */

import prisma from '@/lib/db';
import type { WidgetSpec, MeasureSnapshot } from './types';
import { isRawSqlWidget } from './types';

// ── validateWidgetReferences ──────────────────────────────────────────────────

export interface WidgetReferenceValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Confirms that every dimensionId and measureId referenced in every widget's
 * semanticQuery belongs to an entity whose model_id matches dashboardModelId.
 *
 * This is a JSONB-content check — the DB has no FK enforcement on widget JSON.
 * Rejects with errors[] if any cross-model reference is found.
 *
 * Called before INSERT into platform_dashboard_versions.
 */
export async function validateWidgetReferences(
  widgets: WidgetSpec[],
  dashboardModelId: string,
  orgId: string,
): Promise<WidgetReferenceValidationResult> {
  const errors: string[] = [];

  // Collect all referenced dim/measure IDs across all widgets
  const allDimIds = new Set<string>();
  const allMeasureIds = new Set<string>();

  for (const w of widgets) {
    // Raw-SQL widgets (Phase 3.5C) carry no model references — nothing to
    // cross-model-validate. Skip them entirely.
    if (isRawSqlWidget(w)) continue;
    for (const d of w.semanticQuery.dimensions) allDimIds.add(d.dimensionId);
    for (const m of w.semanticQuery.measures)   allMeasureIds.add(m.measureId);
  }

  if (allDimIds.size === 0 && allMeasureIds.size === 0) {
    return { valid: true, errors: [] };
  }

  // Fetch the entity IDs that belong to the dashboard's model
  const modelEntities = await prisma.platform_sem_entities.findMany({
    where: { model_id: dashboardModelId, org_id: orgId },
    select: { id: true },
  });
  const modelEntityIdSet = new Set(modelEntities.map((e) => e.id));

  // Check dimensions. DRAFT (3.5A) definitions are personal/owner-only and must
  // NEVER enter a durable, shared dashboard version — reject them at save time
  // (they resolve as "not found", failing validation) even though the picker
  // already hides them. Candidates remain valid (dashboards may reference CAND).
  if (allDimIds.size > 0) {
    const dimRows = await prisma.platform_sem_dimensions.findMany({
      where: { id: { in: Array.from(allDimIds) }, org_id: orgId, status: { not: 'draft' } },
      select: { id: true, entity_id: true },
    });

    const foundDimIds = new Set(dimRows.map((d) => d.id));

    for (const dimId of allDimIds) {
      if (!foundDimIds.has(dimId)) {
        errors.push(`Dimension '${dimId}' not found in org`);
        continue;
      }
      const row = dimRows.find((d) => d.id === dimId)!;
      if (!modelEntityIdSet.has(row.entity_id)) {
        errors.push(
          `Dimension '${dimId}' belongs to entity '${row.entity_id}' which is not part of model '${dashboardModelId}'`,
        );
      }
    }
  }

  // Check measures — same draft exclusion as dimensions above.
  if (allMeasureIds.size > 0) {
    const measureRows = await prisma.platform_sem_measures.findMany({
      where: { id: { in: Array.from(allMeasureIds) }, org_id: orgId, status: { not: 'draft' } },
      select: { id: true, entity_id: true },
    });

    const foundMeasureIds = new Set(measureRows.map((m) => m.id));

    for (const measId of allMeasureIds) {
      if (!foundMeasureIds.has(measId)) {
        errors.push(`Measure '${measId}' not found in org`);
        continue;
      }
      const row = measureRows.find((m) => m.id === measId)!;
      if (!modelEntityIdSet.has(row.entity_id)) {
        errors.push(
          `Measure '${measId}' belongs to entity '${row.entity_id}' which is not part of model '${dashboardModelId}'`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── computeMeasureSnapshots ───────────────────────────────────────────────────

/**
 * Fetches current aggregate/expression/metric_type for a set of measure IDs
 * and returns them as MeasureSnapshot[].
 *
 * Called at version-save time. The returned snapshots are embedded into each
 * WidgetSpec before writing to platform_dashboard_versions.widgets.
 *
 * If a measureId is not found (deleted or wrong org), it is omitted from the
 * result — the caller's cross-model validation should catch this first.
 */
export async function computeMeasureSnapshots(
  measureIds: string[],
  orgId: string,
): Promise<MeasureSnapshot[]> {
  if (measureIds.length === 0) return [];

  // Draft measures (3.5A) are never snapshotted into a durable dashboard
  // version — they are omitted here, so a draft can never be frozen into a
  // saved artifact even if a stale id reaches this path.
  const rows = await prisma.platform_sem_measures.findMany({
    where: { id: { in: measureIds }, org_id: orgId, status: { not: 'draft' } },
    select: {
      id: true,
      aggregate: true,
      expression: true,
      metric_type: true,
    },
  });

  return rows.map((r) => ({
    measureId: r.id,
    aggregate: r.aggregate,
    expression: r.expression ?? null,
    metric_type: r.metric_type,
  }));
}
