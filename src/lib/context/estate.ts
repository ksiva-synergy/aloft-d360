import 'server-only';

import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import { DatabricksAdapter } from './databricks-adapter';
import type { ContextSource } from './types';
import { buildFullPath } from './types';
import type { PlatformContextSource } from '@prisma/client';

/** Objects not inventoried within this window are flagged stale on the estate overview. */
export const ESTATE_STALE_SWEEP_DAYS = 7;

export interface EstateInventoryStats {
  inserted: number;
  updated: number;
  removed: number;
  catalogs: number;
  mode: 'system' | 'per-catalog';
}

function toContextSource(row: PlatformContextSource): ContextSource {
  return {
    id: row.id,
    org_id: row.org_id,
    connection_kind: row.connection_kind,
    connection_ref: row.connection_ref,
    display_name: row.display_name,
    scope_include: Array.isArray(row.scope_include)
      ? (row.scope_include as string[])
      : null,
    scope_exclude: Array.isArray(row.scope_exclude)
      ? (row.scope_exclude as string[])
      : null,
    harvest_config: (row.harvest_config as any) ?? null,
    status: row.status,
    last_sweep_at: row.last_sweep_at,
  };
}

export async function runEstateInventory(
  sourceId: string,
  orgId: string,
): Promise<EstateInventoryStats> {
  const sweepStart = new Date();

  const sourceRow = await prisma.platformContextSource.findFirstOrThrow({
    where: { id: sourceId, org_id: orgId },
  });

  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: sourceRow.connection_ref },
    select: { id: true, workspace_host: true, default_warehouse_id: true },
  });

  const adapter = new DatabricksAdapter(conn);
  const source = toContextSource(sourceRow);

  const stats: EstateInventoryStats = {
    inserted: 0,
    updated: 0,
    removed: 0,
    catalogs: 0,
    mode: 'system',
  };

  const catalogsSeen = new Set<string>();

  for await (const batch of adapter.inventoryEstate(source)) {
    if (batch.length === 0) continue;

    for (const row of batch) {
      catalogsSeen.add(row.table_catalog);
    }

    const { insertCount, updateCount } = await upsertBatch(batch, sourceId, orgId);
    stats.inserted += insertCount;
    stats.updated += updateCount;
  }

  stats.catalogs = catalogsSeen.size;
  stats.mode = adapter.queryCount <= 3 ? 'system' : 'per-catalog';

  // Diff soft-delete: mark rows not seen in this sweep
  const removeResult = await prisma.$executeRawUnsafe(
    `UPDATE platform_estate_objects
     SET lifecycle = 'removed'
     WHERE org_id = $1
       AND source_id = $2
       AND lifecycle = 'active'
       AND last_inventoried_at < $3`,
    orgId,
    sourceId,
    sweepStart,
  );
  stats.removed = removeResult;

  // Audit row
  await prisma.platformContextJob.create({
    data: {
      org_id: orgId,
      source_id: sourceId,
      job_kind: 'estate_inventory',
      trigger: 'on_demand',
      status: 'succeeded',
      started_at: sweepStart,
      finished_at: new Date(),
      stats: stats as unknown as Prisma.InputJsonValue,
    },
  });

  return stats;
}

export interface EstateHarvestSyncRow {
  catalog_name: string;
  schema_name: string;
  object_name: string;
  object_kind: string;
  native_comment: string | null;
  source_altered_at: Date | null;
}

/**
 * Upsert discovery inventory rows for objects found during T0 harvest.
 * Keeps platform_estate_objects in sync without waiting for the next
 * estate_inventory sweep.
 */
export async function syncEstateFromHarvest(
  orgId: string,
  sourceId: string,
  objects: EstateHarvestSyncRow[],
): Promise<{ inserted: number; updated: number }> {
  if (objects.length === 0) return { inserted: 0, updated: 0 };

  const batch = objects.map((obj) => ({
    table_catalog: obj.catalog_name,
    table_schema: obj.schema_name,
    table_name: obj.object_name,
    table_type: obj.object_kind,
    comment: obj.native_comment,
    last_altered: obj.source_altered_at?.toISOString() ?? null,
  }));

  const { insertCount, updateCount } = await upsertBatch(batch, sourceId, orgId);
  return { inserted: insertCount, updated: updateCount };
}

async function upsertBatch(
  batch: { table_catalog: string; table_schema: string; table_name: string; table_type: string; comment: string | null; last_altered: string | null }[],
  sourceId: string,
  orgId: string,
): Promise<{ insertCount: number; updateCount: number }> {
  const { createId } = await import('@paralleldrive/cuid2');

  // Deduplicate by full_path — ON CONFLICT cannot update the same row twice in one statement
  const seen = new Set<string>();
  const deduped = batch.filter(row => {
    const fp = buildFullPath(row.table_catalog, row.table_schema, row.table_name);
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });

  const valuePlaceholders: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const row of deduped) {
    const id = createId();
    const fullPath = buildFullPath(row.table_catalog, row.table_schema, row.table_name);
    const lastAlteredVal = row.last_altered ? new Date(row.last_altered) : null;

    valuePlaceholders.push(
      `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9})`
    );
    params.push(
      id, orgId, sourceId, fullPath,
      row.table_catalog, row.table_schema, row.table_name,
      row.table_type, row.comment ?? null, lastAlteredVal,
    );
    idx += 10;
  }

  const sql = `
    INSERT INTO platform_estate_objects
      (id, org_id, source_id, full_path, catalog_name, schema_name,
       object_name, object_type, comment, last_altered_src)
    VALUES ${valuePlaceholders.join(', ')}
    ON CONFLICT (org_id, full_path) DO UPDATE SET
      object_type         = EXCLUDED.object_type,
      comment             = EXCLUDED.comment,
      last_altered_src    = EXCLUDED.last_altered_src,
      source_id           = EXCLUDED.source_id,
      lifecycle           = 'active',
      last_inventoried_at = now()
    RETURNING (xmax = 0) AS is_insert
  `;

  const results = await prisma.$queryRawUnsafe<{ is_insert: boolean }[]>(sql, ...params);

  let insertCount = 0;
  let updateCount = 0;
  for (const r of results) {
    if (r.is_insert) insertCount++;
    else updateCount++;
  }

  return { insertCount, updateCount };
}
