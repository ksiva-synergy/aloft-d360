import 'server-only';

import type { PlatformContextSource } from '@prisma/client';
import prisma from '@/lib/db';
import { DatabricksAdapter } from './databricks-adapter';
import { syncEstateFromHarvest } from './estate';
import { saveProfile } from './profile';
import type { ContextSource, HarvestConfig, ProfileBudget } from './types';

const minimatch = require('minimatch') as (p: string, pattern: string, opts?: { dot?: boolean }) => boolean;

function matchesPatterns(fullPath: string, patterns: string[]): boolean {
  return patterns.some(pat => minimatch(fullPath, pat, { dot: true }));
}

// ── Prisma → adapter type bridge ──────────────────────────────────────────────

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
    harvest_config:
      row.harvest_config !== null &&
      typeof row.harvest_config === 'object' &&
      !Array.isArray(row.harvest_config)
        ? (row.harvest_config as HarvestConfig)
        : null,
    status: row.status,
    last_sweep_at: row.last_sweep_at,
  };
}

// ── Public result type ────────────────────────────────────────────────────────

export interface HarvestResult {
  jobId: string;
  objectsSwept: number;
  columnsUpserted: number;
  queriesIssued: number;
  droppedObjects: number;
  isFullSweep: boolean;
  status: 'succeeded' | 'failed' | 'partial';
  error?: string;
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Run a T0 structural harvest for the given source.
 *
 * First run (last_sweep_at IS NULL) → full scope sweep + lifecycle drop pass.
 * Subsequent runs → change-detect delta; no lifecycle pass (only full sweeps
 * mark objects as dropped). See PHASE_CH1_DECISIONS.md D-12.
 *
 * CH4 moves invocation to the job queue. For now the runner is called inline.
 */
export async function runT0Harvest(
  sourceId: string,
  opts?: { excludeSchemas?: string[]; includePatterns?: string[]; forceFullScan?: boolean },
): Promise<HarvestResult> {
  // ── 1. Load source ──────────────────────────────────────────────────────────
  const sourceRow = await prisma.platformContextSource.findUniqueOrThrow({
    where: { id: sourceId },
  });

  const orgId = sourceRow.org_id;
  // includePatterns is a positive scope override ("only look at this subset of the source").
  // It must force resolveScope regardless of last_sweep_at because detectChanges only returns
  // recently-altered refs — it would miss unaltered tables in the targeted subset.
  //
  // excludeSchemas is a negative filter ("skip these schemas"). It is NOT a reason to force
  // resolveScope on its own: if last_sweep_at is set, delta mode (detectChanges) is still
  // correct and excludeSchemas is applied via scope_exclude before the adapter call either way.
  // Treating excludeSchemas as a resolveScope trigger was causing subsequent runs to do a
  // re-scan of the full allowed scope on every manual launch, ignoring the delta baseline.
  const hasIncludeOverride = (opts?.includePatterns?.length ?? 0) > 0;
  const isFirstRun = sourceRow.last_sweep_at === null || (opts?.forceFullScan ?? false) || hasIncludeOverride;
  if (opts?.forceFullScan) {
    console.log(`[t0_structural] forceFullScan=true — using resolveScope instead of detectChanges`);
  }
  if (hasIncludeOverride && !opts?.forceFullScan) {
    console.log(`[t0_structural] includePatterns override (${opts!.includePatterns!.join(', ')}) — forcing resolveScope`);
  }
  const source = toContextSource(sourceRow);

  // Job-level includePatterns narrows scope_include without touching the DB.
  // Full glob patterns like "catalog.schema.table" or "catalog.schema.*".
  if (opts?.includePatterns?.length) {
    source.scope_include = opts.includePatterns;
    console.log(`[t0_structural] overriding scope_include: ${opts.includePatterns.join(', ')}`);
  }

  // Merge job-level excludeSchemas into scope_exclude globs for resolveScope.
  // Input format is "catalog.schema" (as sent by the UI) — build a catalog-qualified
  // glob "catalog.schema.*" so the exclusion is scoped to that catalog only.
  // Bare schema names (no ".") fall back to "*.schema.*" for backward compatibility.
  if (opts?.excludeSchemas?.length) {
    const extraExcludes = opts.excludeSchemas.map(s =>
      s.includes('.') ? `${s}.*` : `*.${s}.*`,
    );
    source.scope_exclude = [...(source.scope_exclude ?? []), ...extraExcludes];
    console.log(`[t0_structural] applying excludeSchemas: ${opts.excludeSchemas.join(', ')}`);
  }

  // ── 2. Create job row (status = running) ────────────────────────────────────
  const job = await prisma.platformContextJob.create({
    data: {
      org_id: orgId,
      source_id: sourceId,
      job_kind: 't0_structural',
      trigger: 'on_demand',
      status: 'running',
      started_at: new Date(),
    },
  });

  try {
    // ── 3. Load connection and build adapter ──────────────────────────────────
    const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
      where: { id: source.connection_ref },
      select: { id: true, workspace_host: true, default_warehouse_id: true },
    });

    const adapter = new DatabricksAdapter(conn);

    // ── 4. Resolve refs ───────────────────────────────────────────────────────
    const refs = isFirstRun
      ? await adapter.resolveScope(source)
      : await adapter.detectChanges(source, sourceRow.last_sweep_at!);

    console.log(`[t0_structural] source=${sourceId} refs=${refs.length} isFirstRun=${isFirstRun}`);

    // ── 5. Harvest structure ──────────────────────────────────────────────────
    const queryBudget = source.harvest_config?.query_budget;
    const structuralMeta = await adapter.harvestStructure(
      refs,
      queryBudget !== undefined ? { queryBudget } : undefined,
    );

    console.log(`[t0_structural] harvested ${structuralMeta.length} objects, upserting…`);

    // ── 6. Upsert objects + columns ───────────────────────────────────────────
    const now = new Date();
    const harvestedPaths = new Set<string>();
    let columnsUpserted = 0;
    let objIdx = 0;

    for (const meta of structuralMeta) {
      harvestedPaths.add(meta.ref.full_path);
      objIdx++;

      if (objIdx % 50 === 0 || objIdx === structuralMeta.length) {
        console.log(`[t0_structural] upserted ${objIdx}/${structuralMeta.length} objects (${columnsUpserted} cols so far)`);
      }

      const obj = await prisma.platformContextObject.upsert({
        where: {
          source_id_full_path: { source_id: sourceId, full_path: meta.ref.full_path },
        },
        create: {
          source_id: sourceId,
          org_id: orgId,
          object_kind: meta.object_kind,
          full_path: meta.ref.full_path,
          catalog_name: meta.ref.catalog_name,
          schema_name: meta.ref.schema_name,
          object_name: meta.ref.object_name,
          native_comment: meta.native_comment,
          source_altered_at: meta.source_altered_at,
          last_t0_at: now,
          lifecycle: 'active',
        },
        update: {
          object_kind: meta.object_kind,
          native_comment: meta.native_comment,
          source_altered_at: meta.source_altered_at,
          last_t0_at: now,
          lifecycle: 'active',
        },
        select: { id: true },
      });

      for (const col of meta.columns) {
        await prisma.platformContextColumn.upsert({
          where: { object_id_name: { object_id: obj.id, name: col.name } },
          create: {
            object_id: obj.id,
            org_id: orgId,
            name: col.name,
            ordinal: col.ordinal,
            data_type: col.data_type,
            is_nullable: col.is_nullable,
            native_comment: col.native_comment,
            lifecycle: 'active',
          },
          update: {
            ordinal: col.ordinal,
            data_type: col.data_type,
            is_nullable: col.is_nullable,
            native_comment: col.native_comment,
            lifecycle: 'active',
          },
        });
        columnsUpserted++;
      }
    }

    // ── 7. Full-sweep lifecycle pass ──────────────────────────────────────────
    // Only on first run: objects absent from the current sweep are marked dropped.
    // Delta runs (detectChanges) don't carry the full set of active objects so
    // we cannot safely infer what's dropped. See PHASE_CH1_DECISIONS.md D-12.
    //
    // Scoped runs (hasIncludeOverride) must only drop objects within the schemas that
    // were actually harvested. Objects in schemas outside the job's scope are
    // invisible to this run and must never be touched.
    let droppedObjects = 0;
    if (isFirstRun && harvestedPaths.size > 0) {
      if (hasIncludeOverride) {
        // Derive the set of schema names that were actually in scope by extracting
        // the schema segment (index 1) from each harvested full_path (catalog.schema.object).
        const harvestedSchemas = new Set<string>();
        for (const p of harvestedPaths) {
          const parts = p.split('.');
          if (parts.length >= 2) harvestedSchemas.add(parts[1]);
        }
        if (harvestedSchemas.size > 0) {
          const dropped = await prisma.platformContextObject.updateMany({
            where: {
              source_id: sourceId,
              lifecycle: 'active',
              schema_name: { in: [...harvestedSchemas] },
              full_path: { notIn: [...harvestedPaths] },
            },
            data: { lifecycle: 'dropped' },
          });
          droppedObjects = dropped.count;
          console.log(
            `[t0_structural] scoped drop: ${droppedObjects} objects dropped within ${harvestedSchemas.size} schema(s) — schemas outside this run's scope were not touched`,
          );
        }
      } else {
        // Full unscoped sweep — the job saw the entire source, so any active
        // object not present is genuinely gone.
        const dropped = await prisma.platformContextObject.updateMany({
          where: {
            source_id: sourceId,
            lifecycle: 'active',
            full_path: { notIn: [...harvestedPaths] },
          },
          data: { lifecycle: 'dropped' },
        });
        droppedObjects = dropped.count;
      }
    }

    const estateSync = await syncEstateFromHarvest(
      orgId,
      sourceId,
      structuralMeta.map((meta) => ({
        catalog_name: meta.ref.catalog_name,
        schema_name: meta.ref.schema_name,
        object_name: meta.ref.object_name,
        object_kind: meta.object_kind,
        native_comment: meta.native_comment,
        source_altered_at: meta.source_altered_at,
      })),
    );
    console.log(
      `[t0_structural] estate sync — inserted=${estateSync.inserted} updated=${estateSync.updated}`,
    );

    console.log(`[t0_structural] done — objects=${structuralMeta.length} cols=${columnsUpserted} dropped=${droppedObjects} queries=${adapter.queryCount}`);

    // ── 8. Stamp last_sweep_at on the source ──────────────────────────────────
    // Only advance last_sweep_at when this run saw the full allowed scope of the source.
    // A run with includePatterns only covers a subset — stamping here would cause the
    // next unscoped run to enter delta mode against a baseline that doesn't reflect the
    // full source, silently missing every unaltered object outside the prior subset.
    // excludeSchemas-only runs still advance the timestamp because they reflect a complete
    // pass over the non-excluded portion (the intentional scope of this source).
    if (!hasIncludeOverride) {
      await prisma.platformContextSource.update({
        where: { id: sourceId },
        data: { last_sweep_at: now },
      });
    } else {
      console.log(`[t0_structural] scoped run (includePatterns) — skipping last_sweep_at update to preserve full-source delta baseline`);
    }

    // ── 9. Mark job succeeded ─────────────────────────────────────────────────
    const stats = {
      objects_swept: structuralMeta.length,
      columns_upserted: columnsUpserted,
      queries_issued: adapter.queryCount,
      dropped_objects: droppedObjects,
      // is_full_sweep: used resolveScope AND covered the full source (no includePatterns subset)
      is_full_sweep: isFirstRun && !hasIncludeOverride,
    };

    await prisma.platformContextJob.update({
      where: { id: job.id },
      data: { status: 'succeeded', finished_at: new Date(), stats },
    });

    return {
      jobId: job.id,
      objectsSwept: structuralMeta.length,
      columnsUpserted,
      queriesIssued: adapter.queryCount,
      droppedObjects,
      isFullSweep: isFirstRun,
      status: 'succeeded',
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[t0_structural] ERROR: ${errorMsg}`);

    // Best-effort: update job to failed; don't throw if this update itself fails
    await prisma.platformContextJob
      .update({
        where: { id: job.id },
        data: { status: 'failed', finished_at: new Date(), error: errorMsg },
      })
      .catch(() => undefined);

    return {
      jobId: job.id,
      objectsSwept: 0,
      columnsUpserted: 0,
      queriesIssued: 0,
      droppedObjects: 0,
      isFullSweep: isFirstRun,
      status: 'failed',
      error: errorMsg,
    };
  }
}

/**
 * Run a T1 statistical profile and drift analysis for the given source.
 *
 * For each active PlatformContextObject:
 * 1. Executes statistical profile query (and optional describe detail) via the adapter.
 * 2. Compares stats against the latest existing profile version to calculate drift.
 * 3. Saves stats and drift in a new PlatformContextProfile row, incrementing the version.
 * 4. Updates PlatformContextObject row_count_est, size_bytes_est, last_t1_at.
 * 5. Updates PlatformContextColumn profile JSON columns for the object's active columns.
 */
export async function runT1Profile(
  sourceId: string,
  opts?: {
    excludeSchemas?: string[];
    includePatterns?: string[];
    existingJobId?: string;
    /** Auto-split: restrict DB query to a single catalog+schema partition */
    partitionCatalog?: string;
    partitionSchema?: string;
    /** Auto-split: if set, only profile these object names within the partition */
    partitionObjects?: string[];
  },
): Promise<HarvestResult> {
  const sourceRow = await prisma.platformContextSource.findUniqueOrThrow({
    where: { id: sourceId },
  });

  const orgId = sourceRow.org_id;
  const source = toContextSource(sourceRow);

  // 1. Reuse the orchestrator-claimed job row, or create a new one if called standalone
  let jobId: string;
  if (opts?.existingJobId) {
    jobId = opts.existingJobId;
  } else {
    const job = await prisma.platformContextJob.create({
      data: {
        org_id: orgId,
        source_id: sourceId,
        job_kind: 't1_profile',
        trigger: 'on_demand',
        status: 'running',
        started_at: new Date(),
      },
    });
    jobId = job.id;
  }

  try {
    // 2. Load connection and build adapter
    const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
      where: { id: source.connection_ref },
      select: { id: true, workspace_host: true, default_warehouse_id: true },
    });

    const adapter = new DatabricksAdapter(conn);

    // 3. Load all active objects and their active columns, then apply glob filtering in JS
    const allObjects = await prisma.platformContextObject.findMany({
      where: {
        source_id: sourceId,
        lifecycle: 'active',
        ...(opts?.partitionCatalog ? { catalog_name: opts.partitionCatalog } : {}),
        ...(opts?.partitionSchema ? { schema_name: opts.partitionSchema } : {}),
        ...(opts?.partitionObjects?.length ? { object_name: { in: opts.partitionObjects } } : {}),
      },
      include: {
        columns: {
          where: { lifecycle: 'active' },
        },
      },
    });

    // excludeSchemas format is "catalog.schema" — filter by exact catalog+schema pair.
    // Bare schema names (no ".") match any catalog for backward compatibility.
    const excludeSet = new Set((opts?.excludeSchemas ?? []).map(s => s.toLowerCase()));
    const activeObjects = (() => {
      let objs = allObjects;
      if (!opts?.partitionSchema && excludeSet.size > 0) {
        objs = objs.filter(o => {
          const qualifiedKey = `${o.catalog_name}.${o.schema_name}`;
          return !excludeSet.has(qualifiedKey)
            && !(o.schema_name != null && excludeSet.has(o.schema_name));
        });
      }
      if (!opts?.partitionCatalog && opts?.includePatterns?.length) {
        objs = objs.filter(o => matchesPatterns(o.full_path, opts.includePatterns!));
      }
      return objs;
    })();

    if (opts?.includePatterns?.length) {
      console.log(`[t1_profile] scoped to ${opts.includePatterns.join(', ')} — ${activeObjects.length} objects`);
    } else if (opts?.excludeSchemas?.length) {
      console.log(`[t1_profile] excluding schemas: ${opts.excludeSchemas.join(', ')} — profiling ${activeObjects.length} objects`);
    } else {
      console.log(`[t1_profile] source=${sourceId} objects=${activeObjects.length}`);
    }

    if (activeObjects.length === 0) {
      const scopeHint = opts?.includePatterns?.length
        ? `includePatterns=${opts.includePatterns.join(', ')}`
        : opts?.excludeSchemas?.length
          ? `${opts.excludeSchemas.length} excludeSchemas (all active objects filtered out)`
          : 'no scope filters';
      const errorMsg = `No active objects matched T1 scope (${scopeHint})`;
      console.error(`[t1_profile] ${errorMsg}`);

      await prisma.platformContextJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          finished_at: new Date(),
          stats: { objects_profiled: 0, objects_failed: 0, queries_issued: 0 },
          error: errorMsg,
        },
      });

      return {
        jobId,
        objectsSwept: 0,
        columnsUpserted: 0,
        queriesIssued: 0,
        droppedObjects: 0,
        isFullSweep: false,
        status: 'failed',
        error: errorMsg,
      };
    }

    let queriesIssued = 0;
    let profilesCreated = 0;
    const objectErrors: string[] = [];

    for (const obj of activeObjects) {
      console.log(`[T1 Profile] Profiling ${obj.full_path} ...`);
      try {
        // 4. Build ProfileBudget, passing columns and estimated row count from Postgres
        const budget: ProfileBudget = {
          maxStatements: 3, // Budget of 3 queries per object
          tableSamplePct: source.harvest_config?.tablesample_pct ?? 10,
          tableSampleThreshold: source.harvest_config?.tablesample_threshold ?? 5_000_000,
          estimatedRows: obj.row_count_est ? Number(obj.row_count_est) : undefined,
          objectKind: obj.object_kind ?? undefined,
          columns: obj.columns.map(c => ({
            name: c.name,
            data_type: c.data_type ?? 'string',
            is_nullable: c.is_nullable ?? true,
          })),
        };

        const startQueries = adapter.queryCount;
        const profileResult = await adapter.harvestProfile({
          source_id: sourceId,
          connection_id: source.connection_ref,
          full_path: obj.full_path,
          catalog_name: obj.catalog_name ?? '',
          schema_name: obj.schema_name ?? '',
          object_name: obj.object_name ?? '',
        }, budget);
        queriesIssued += (adapter.queryCount - startQueries);

        // 5. Persist profile + compute drift via profile.ts
        await saveProfile(obj.id, orgId, profileResult, 'on_demand');

        // 6. Update PlatformContextObject row_count_est, size_bytes_est, last_t1_at
        const currStats = profileResult.stats as Record<string, unknown>;
        const rawRowCount = currStats.row_count;
        const rawSizeBytes = currStats.size_bytes;
        const rowCountVal = rawRowCount !== null && rawRowCount !== undefined ? BigInt(rawRowCount as number) : null;
        const sizeBytesVal = rawSizeBytes !== null && rawSizeBytes !== undefined ? BigInt(rawSizeBytes as number) : null;

        await prisma.platformContextObject.update({
          where: { id: obj.id },
          data: {
            row_count_est: rowCountVal,
            size_bytes_est: sizeBytesVal,
            last_t1_at: new Date(),
          },
        });

        profilesCreated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const line = `${obj.full_path}: ${msg}`;
        console.error(`[t1_profile] object failed: ${line}`);
        objectErrors.push(line);
      }
    }

    const finalStatus: 'succeeded' | 'failed' | 'partial' =
      objectErrors.length === 0 ? 'succeeded'
      : profilesCreated > 0 ? 'partial'
      : 'failed';

    const stats = {
      objects_profiled: profilesCreated,
      objects_failed: objectErrors.length,
      queries_issued: queriesIssued,
    };

    await prisma.platformContextJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        finished_at: new Date(),
        stats,
        ...(objectErrors.length > 0 ? { error: objectErrors.slice(0, 10).join('\n') } : {}),
      },
    });

    return {
      jobId,
      objectsSwept: profilesCreated,
      columnsUpserted: 0,
      queriesIssued,
      droppedObjects: 0,
      isFullSweep: false,
      status: finalStatus,
      ...(objectErrors.length > 0 ? { error: objectErrors.slice(0, 3).join('\n') } : {}),
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[t1_profile] ERROR: ${errorMsg}`);

    await prisma.platformContextJob
      .update({
        where: { id: jobId },
        data: { status: 'failed', finished_at: new Date(), error: errorMsg },
      })
      .catch(() => undefined);

    return {
      jobId,
      objectsSwept: 0,
      columnsUpserted: 0,
      queriesIssued: 0,
      droppedObjects: 0,
      isFullSweep: false,
      status: 'failed',
      error: errorMsg,
    };
  }
}
