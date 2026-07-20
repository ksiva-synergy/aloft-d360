/**
 * Harvest Orchestrator — ECS/Fargate entry point.
 *
 * Usage (local):
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/orchestrator.ts [--sweep]
 *
 * --sweep          Enqueue a change_detect job for every active source before the
 *                  main dispatch loop runs.
 * --child-job <id> Run a single specific child job (auto-split mode). The container
 *                  claims only that job, processes it, then calls advanceChildren.
 */

import prisma from '@/lib/db';
import { enqueue, claimNext, failStale, finalize, advanceChildren } from '@/lib/context/queue';
import { runT0Harvest, runT1Profile } from '@/lib/context/harvest';
import { runT2Enrich } from '@/lib/context/enrich';
import { runEstateInventory } from '@/lib/context/estate';
import { runT3Usage } from '@/lib/context/usage';
import { embedSubjects, TITAN_MODEL } from '@/lib/context/embed';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';
import { getDefaultOrg } from '@/lib/platform/agents';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import type { ContextSource } from '@/lib/context/types';
import type { PlatformContextSource, PlatformContextJob } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { JobKind } from '@/lib/context/queue';
// NOTE: The T4 tier (scan / entity-propose / dim-propose) depends on
// scripts/context/t4-handlers.ts → the scripts/inspector/ subsystem, which was
// not ported to this repo. The T4 cases below are stubbed. To re-enable, port
// scripts/context/t4-handlers.ts and scripts/inspector/ from aloft-platform and
// restore this import: import { runT4Scan, runT4EntityPropose, runT4DimPropose } from './t4-handlers';
import { acquireOrchestratorLock } from '@/lib/memory/lock';

// ── ECS constants (mirrored from launch route) ────────────────────────────────

const ECS_CLUSTER = 'aloft-agents-prod';
const TASK_DEFINITION = 'aloft-context-harvester';
const CONTAINER_NAME = 'context-harvester';
const SUBNETS = ['subnet-03ee2945ebdafd883', 'subnet-0a6a530408b9e906a'];
const SECURITY_GROUPS = ['sg-04f5d2b63c1efd690'];
const REGION = 'ap-south-1';

const BASE_COMMAND = [
  'npx', 'tsx',
  '--require', './scripts/context/noserver.cjs',
  'scripts/context/orchestrator.ts',
];

/**
 * Enqueue the next kind in a sequential chain and launch a Fargate task for it.
 * Copies excludeSchemas, includePatterns and the remaining chain tail from the
 * parent job's scope so the new container continues with the same settings.
 */
async function advanceChain(
  orgId: string,
  parentScope: Record<string, unknown>,
  sourceId: string,
) {
  const chain = Array.isArray(parentScope.chain) ? (parentScope.chain as string[]) : [];
  if (chain.length === 0) return;

  const [nextKind, ...remaining] = chain as JobKind[];

  const childScope: Record<string, unknown> = {};
  if (Array.isArray(parentScope.excludeSchemas) && (parentScope.excludeSchemas as string[]).length > 0) {
    childScope.excludeSchemas = parentScope.excludeSchemas;
  }
  if (Array.isArray(parentScope.includePatterns) && (parentScope.includePatterns as string[]).length > 0) {
    childScope.includePatterns = parentScope.includePatterns;
  }
  if (remaining.length > 0) childScope.chain = remaining;

  const scopeOrNull = Object.keys(childScope).length > 0 ? childScope : null;
  await enqueue(nextKind, sourceId, scopeOrNull, 'on_demand', orgId);
  console.log(`[orchestrator] chain: enqueued ${nextKind} (remaining: ${remaining.join(', ') || 'none'})`);

  const ecs = new ECSClient({ region: REGION });
  const result = await ecs.send(new RunTaskCommand({
    cluster: ECS_CLUSTER,
    taskDefinition: TASK_DEFINITION,
    launchType: 'FARGATE',
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: { subnets: SUBNETS, securityGroups: SECURITY_GROUPS, assignPublicIp: 'ENABLED' },
    },
    overrides: {
      containerOverrides: [{ name: CONTAINER_NAME, command: [...BASE_COMMAND, '--kind', nextKind] }],
    },
  }));

  const taskArn = result.tasks?.[0]?.taskArn ?? null;
  const taskId = taskArn ? taskArn.split('/').pop() : null;
  console.log(`[orchestrator] chain: launched Fargate ${nextKind} task=${taskId ?? 'none'}`);

  if (taskId) {
    await prisma.platformContextJob.updateMany({
      where: { org_id: orgId, job_kind: nextKind, status: 'queued', parent_job_id: null },
      data: { scope: { ...(scopeOrNull ?? {}), fargate_task_id: taskId } },
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    harvest_config: null,
    status: row.status,
    last_sweep_at: row.last_sweep_at,
  };
}

// ── Single-job dispatch (used by both full loop and --child-job mode) ─────────

async function dispatchSingleJob(
  job: PlatformContextJob,
  orgId: string,
): Promise<{ status: 'succeeded' | 'failed' | 'partial'; error?: string }> {
  const scope = (job.scope ?? {}) as Record<string, unknown>;

  // Extract partition scope injected by auto-split (partition_catalog / partition_schema)
  const partitionCatalog = typeof scope.partition_catalog === 'string' ? scope.partition_catalog : undefined;
  const partitionSchema = typeof scope.partition_schema === 'string' ? scope.partition_schema : undefined;
  const partitionObjects = Array.isArray(scope.partition_objects) ? (scope.partition_objects as string[]) : undefined;

  // Build effective excludeSchemas + includePatterns respecting partition scope.
  // Keep the full "catalog.schema" format as sent by the UI — stripping the catalog
  // prefix here caused cross-catalog bleed (landing_zone.digital_desk → *.digital_desk.*
  // which also silently excluded reporting_layer.digital_desk etc).
  let effectiveExcludeSchemas = Array.isArray(scope.excludeSchemas)
    ? (scope.excludeSchemas as string[])
    : [];
  let effectiveIncludePatterns = Array.isArray(scope.includePatterns)
    ? (scope.includePatterns as string[])
    : [];

  if (partitionCatalog && partitionSchema) {
    if (partitionObjects && partitionObjects.length > 0) {
      // Explicit object list — use glob patterns per object
      effectiveIncludePatterns = partitionObjects.map(n => `${partitionCatalog}.${partitionSchema}.${n}`);
    } else {
      // All objects in schema
      effectiveIncludePatterns = [`${partitionCatalog}.${partitionSchema}.*`];
    }
    effectiveExcludeSchemas = []; // partition replaces exclude logic
    console.log(`[orchestrator] child partition=${partitionCatalog}.${partitionSchema} objects=${partitionObjects?.length ?? 'all'}`);
  }

  switch (job.job_kind) {
    case 'change_detect': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'change_detect missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const sourceRow = await prisma.platformContextSource.findUniqueOrThrow({ where: { id: job.source_id } });
      const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
        where: { id: sourceRow.connection_ref },
        select: { id: true, workspace_host: true, default_warehouse_id: true },
      });
      const adapter = new DatabricksAdapter(conn);
      const since = sourceRow.last_sweep_at ?? new Date(0);
      const changedRefs = await adapter.detectChanges(toContextSource(sourceRow), since);
      for (const ref of changedRefs) {
        await enqueue('t0_structural', job.source_id, { path: ref.full_path }, 'scheduled', orgId);
      }
      await finalize(job.id, 'succeeded', { changed_refs: changedRefs.length });
      console.log(`[change_detect] source=${job.source_id} flagged=${changedRefs.length} → t0_structural enqueued`);
      return { status: 'succeeded' };
    }

    case 't0_structural': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 't0_structural missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const result = await runT0Harvest(job.source_id, {
        excludeSchemas: effectiveExcludeSchemas,
        includePatterns: effectiveIncludePatterns,
      });
      await finalize(job.id, result.status, {
        dispatched_to_job: result.jobId,
        objects_swept: result.objectsSwept,
        queries_issued: result.queriesIssued,
      }, result.error);
      console.log(`[t0_structural] source=${job.source_id} objects=${result.objectsSwept} status=${result.status}`);
      if (result.status === 'succeeded' && !job.parent_job_id) {
        await advanceChain(orgId, scope, job.source_id);
      }
      return { status: result.status, error: result.error };
    }

    case 't1_profile': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 't1_profile missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const result = await runT1Profile(job.source_id, {
        excludeSchemas: effectiveExcludeSchemas,
        includePatterns: effectiveIncludePatterns,
        existingJobId: job.id,
        ...(partitionCatalog ? { partitionCatalog } : {}),
        ...(partitionSchema ? { partitionSchema } : {}),
        ...(partitionObjects ? { partitionObjects } : {}),
      });
      await finalize(job.id, result.status, {
        dispatched_to_job: result.jobId,
        objects_profiled: result.objectsSwept,
        queries_issued: result.queriesIssued,
      }, result.error);
      console.log(`[t1_profile] source=${job.source_id} objects=${result.objectsSwept} status=${result.status}`);
      if (result.status === 'succeeded' && !job.parent_job_id) {
        await advanceChain(orgId, scope, job.source_id);
      }
      return { status: result.status, error: result.error };
    }

    case 't2_semantic': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 't2_semantic missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const result = await runT2Enrich(job.source_id, job.id, {
        excludeSchemas: effectiveExcludeSchemas,
        includePatterns: effectiveIncludePatterns,
        ...(partitionCatalog ? { partitionCatalog } : {}),
        ...(partitionSchema ? { partitionSchema } : {}),
        ...(partitionObjects ? { partitionObjects } : {}),
      });
      console.log(`[t2_semantic] source=${job.source_id} objects=${result.objectsEnriched} columns=${result.columnsEnriched} cost=$${result.costUsd.toFixed(4)} status=${result.status}`);
      if (result.status === 'succeeded' && !job.parent_job_id) {
        await advanceChain(orgId, scope, job.source_id);
      }
      return { status: result.status };
    }

    case 'estate_inventory': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'estate_inventory missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      const estateResult = await runEstateInventory(job.source_id, orgId);
      await finalize(job.id, 'succeeded', estateResult as unknown as Record<string, unknown>);
      console.log(`[estate_inventory] source=${job.source_id} inserted=${estateResult.inserted} updated=${estateResult.updated} removed=${estateResult.removed} catalogs=${estateResult.catalogs} mode=${estateResult.mode}`);
      return { status: 'succeeded' };
    }

    case 'embed': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 'embed missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }

      const embedObjectRows = await prisma.platformContextObject.findMany({
        where: {
          source_id: job.source_id,
          org_id: orgId,
          lifecycle: 'active',
          last_t2_at: { not: null },
        },
        select: { id: true },
      });
      const embedObjectIds = embedObjectRows.map((o) => o.id);

      const embedAllColRows = await prisma.platformContextColumn.findMany({
        where: {
          org_id: orgId,
          lifecycle: 'active',
          object: { source_id: job.source_id },
        },
        select: { id: true, semantic: true },
      });
      const embedColumnIds = embedAllColRows.filter((c) => c.semantic !== null).map((c) => c.id);

      const embedErrors: string[] = [];
      let embedObjResult = { embedded: 0, skipped: 0, failed: 0 };
      let embedColResult = { embedded: 0, skipped: 0, failed: 0 };

      try {
        embedObjResult = await embedSubjects(orgId, 'object', embedObjectIds);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        embedErrors.push(`objects: ${msg}`);
      }

      try {
        embedColResult = await embedSubjects(orgId, 'column', embedColumnIds);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        embedErrors.push(`columns: ${msg}`);
      }

      const totalEmbedded = embedObjResult.embedded + embedColResult.embedded;
      const embedStatus =
        embedErrors.length === 0 ? 'succeeded' : totalEmbedded > 0 ? 'partial' : 'failed';

      await finalize(
        job.id,
        embedStatus,
        {
          objects_embedded: embedObjResult.embedded,
          columns_embedded: embedColResult.embedded,
          skipped: embedObjResult.skipped + embedColResult.skipped,
          failed: embedObjResult.failed + embedColResult.failed,
          model_id: TITAN_MODEL,
        },
        embedErrors.length > 0 ? embedErrors.join('\n') : undefined,
      );
      console.log(
        `[embed] source=${job.source_id} objects=${embedObjResult.embedded} columns=${embedColResult.embedded}` +
        ` skipped=${embedObjResult.skipped + embedColResult.skipped} failed=${embedObjResult.failed + embedColResult.failed} status=${embedStatus}`,
      );
      return { status: embedStatus };
    }

    case 't3_usage': {
      if (!job.source_id) {
        await finalize(job.id, 'failed', {}, 't3_usage missing source_id');
        return { status: 'failed', error: 'missing source_id' };
      }
      // Pass `since` and `until` from scope if this is a continuation job
      const scopeObj = (job.scope ?? {}) as Record<string, unknown>;
      const since = typeof scopeObj.since === 'string' ? new Date(scopeObj.since) : undefined;
      const until = typeof scopeObj.until === 'string' ? new Date(scopeObj.until) : undefined;
      console.log(`[t3_usage] orchestrator dispatching sourceId=${job.source_id} orgId=${orgId}${since ? ` since=${since.toISOString()}` : ''}${until ? ` until=${until.toISOString()}` : ''}`);
      const t3Result = await runT3Usage(orgId, job.source_id, (since || until) ? { since, until } : undefined);
      await finalize(job.id, 'succeeded', t3Result as unknown as Record<string, unknown>);
      console.log(`[t3_usage] source=${job.source_id} objects=${t3Result.objectsProcessed} snapshots=${t3Result.snapshotsWritten} narratives=${t3Result.narrativesApplied} window=${t3Result.windowStart}→${t3Result.windowEnd}${t3Result.nextCursor ? ` nextCursor=${t3Result.nextCursor}` : ''}`);

      // Spawn continuation job covering the remaining older slice of the window.
      // First job: since=Jun22 → until=now, stops at Jul2T07:55 (nextCursor)
      // Continuation: since=Jun22 → until=Jul2T07:55 (picks up the older half)
      // Enqueue the DB row AND launch a Fargate task so it runs immediately
      // (plain enqueue() leaves the row queued with no task to claim it).
      if (t3Result.nextCursor) {
        const contJob = await enqueue('t3_usage', job.source_id, {
          since: t3Result.windowStart,   // original window start
          until: t3Result.nextCursor,    // where this job stopped
        }, 'on_demand', orgId);
        console.log(`[t3_usage] continuation job enqueued id=${contJob.id} since=${t3Result.windowStart} until=${t3Result.nextCursor}`);

        // Launch a dedicated Fargate task for the continuation job
        try {
          const ecs = new ECSClient({ region: REGION });
          const taskResult = await ecs.send(new RunTaskCommand({
            cluster: ECS_CLUSTER,
            taskDefinition: TASK_DEFINITION,
            launchType: 'FARGATE',
            count: 1,
            networkConfiguration: {
              awsvpcConfiguration: { subnets: SUBNETS, securityGroups: SECURITY_GROUPS, assignPublicIp: 'ENABLED' },
            },
            overrides: {
              containerOverrides: [{ name: CONTAINER_NAME, command: [...BASE_COMMAND, '--kind', 't3_usage'] }],
            },
          }));
          const contTaskId = taskResult.tasks?.[0]?.taskArn?.split('/').pop() ?? null;
          if (contTaskId) {
            await prisma.platformContextJob.update({
              where: { id: contJob.id },
              data: { scope: { since: t3Result.windowStart, until: t3Result.nextCursor, fargate_task_id: contTaskId } as unknown as Prisma.InputJsonValue },
            });
          }
          console.log(`[t3_usage] continuation Fargate task launched id=${contJob.id} taskId=${contTaskId ?? 'none'}`);
        } catch (launchErr) {
          // Non-fatal — the queued row remains and can be launched manually
          console.error(`[t3_usage] continuation task launch failed (job=${contJob.id}): ${launchErr instanceof Error ? launchErr.message : String(launchErr)}`);
        }
      }
      return { status: 'succeeded' };
    }

    case 'mapping': {
      console.log(`[orchestrator] mapping: not yet implemented — requeue skipped`);
      await finalize(job.id, 'succeeded', { note: 'not yet implemented, requeue skipped' });
      return { status: 'succeeded' };
    }

    case 'silo_scan':
    case 'recompute_entity_tags':
    case 'knowledge_sync': {
      console.log(`[orchestrator] ${job.job_kind}: not yet implemented in this container — skipping`);
      await finalize(job.id, 'succeeded', { note: 'not yet implemented in harvester, skipped' });
      return { status: 'succeeded' };
    }

    // T4 tier — scan / entity-propose / dim-propose.
    // These depend on scripts/context/t4-handlers.ts → the scripts/inspector/
    // subsystem, which was not ported to this repo. Jobs are finalized as
    // failed with a clear reason rather than silently succeeding, so scheduled
    // T4 runs surface loudly instead of masquerading as completed work.
    case 't4_scan':
    case 't4_entity_propose':
    case 't4_dim_propose': {
      const reason = `${job.job_kind}: T4/inspector tier not ported to this repo`;
      console.warn(`[orchestrator] ${reason}`);
      await finalize(job.id, 'failed', {}, reason);
      return { status: 'failed', error: reason };
    }

    default: {
      await finalize(job.id, 'failed', {}, `unknown job_kind: ${String(job.job_kind)}`);
      return { status: 'failed', error: `unknown job_kind: ${String(job.job_kind)}` };
    }
  }
}

// ── Core loop (exported for in-process testing) ───────────────────────────────

export interface OrchestratorResult {
  processed: number;
  t1JobsCreated: number;
}

export async function runOrchestratorLoop(
  orgId: string,
  opts: { sweep?: boolean; kindFilter?: string; childJobId?: string } = {},
): Promise<OrchestratorResult> {
  // 1. Reap stale running jobs from prior crashed containers
  const reaped = await failStale(30);
  if (reaped > 0) console.log(`[orchestrator] reaped ${reaped} stale job(s)`);

  // 2. --child-job mode: process exactly one specific child job then advance the split queue
  if (opts.childJobId) {
    const job = await prisma.platformContextJob.findUnique({ where: { id: opts.childJobId } });
    if (!job) {
      console.error(`[orchestrator] child-job=${opts.childJobId} not found`);
      return { processed: 0, t1JobsCreated: 0 };
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      console.log(`[orchestrator] child-job=${opts.childJobId} already ${job.status} — skipping`);
      return { processed: 0, t1JobsCreated: 0 };
    }

    // advanceChildren now marks the row 'running' atomically before launching the
    // Fargate task, so the status may already be 'running' by the time we arrive here.
    // Only write started_at if we're claiming a still-queued row.
    if (job.status === 'queued') {
      await prisma.platformContextJob.update({
        where: { id: job.id },
        data: { status: 'running', started_at: new Date() },
      });
    }

    console.log(`[orchestrator] child-job mode: job=${job.id} kind=${job.job_kind} partition=${(job.scope as any)?.partition_schema ?? 'full'}`);

    try {
      await dispatchSingleJob(job, orgId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] child-job=${job.id} error:`, msg);
      try { await finalize(job.id, 'failed', {}, msg); } catch { /* best-effort */ }
    }

    // Advance the parent's queue: launch next batch of children
    if (job.parent_job_id) {
      const { launched, parentFinalized } = await advanceChildren(
        job.parent_job_id,
        orgId,
        job.job_kind as JobKind,
      );
      console.log(`[orchestrator] advanceChildren parent=${job.parent_job_id} launched=${launched} parentFinalized=${parentFinalized}`);

      // If parent just finalized AND it has a chain, advance chain from parent
      if (parentFinalized) {
        const parent = await prisma.platformContextJob.findUnique({ where: { id: job.parent_job_id } });
        if (parent && parent.status === 'succeeded' && parent.source_id) {
          const parentScope = (parent.scope ?? {}) as Record<string, unknown>;
          if (Array.isArray(parentScope.chain) && (parentScope.chain as string[]).length > 0) {
            await advanceChain(orgId, parentScope, parent.source_id);
          }
        }
      }
    }

    return { processed: 1, t1JobsCreated: job.job_kind === 't1_profile' ? 1 : 0 };
  }

  // 3. --sweep: enqueue change_detect for every active source
  if (opts.sweep) {
    const sources = await prisma.platformContextSource.findMany({
      where: { org_id: orgId, status: 'active' },
      select: { id: true },
    });
    for (const src of sources) {
      await enqueue('change_detect', src.id, null, 'scheduled', orgId);
    }
    console.log(`[orchestrator] enqueued ${sources.length} change_detect job(s) for sweep`);
  }

  // 4. Main dispatch loop (non-split top-level jobs)
  let processed = 0;
  let t1JobsCreated = 0;
  const kindFilter = opts.kindFilter ?? null;

  if (kindFilter) {
    console.log(`[orchestrator] filtering to kind=${kindFilter}`);
  }

  while (true) {
    const job = await claimNext(orgId, kindFilter ?? undefined);
    if (!job) break;

    console.log(`[orchestrator] claimed job=${job.id} kind=${job.job_kind}`);
    processed++;

    try {
      const result = await dispatchSingleJob(job, orgId);
      if (job.job_kind === 't1_profile' && result.status !== 'failed') t1JobsCreated++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] job=${job.id} kind=${job.job_kind} error:`, msg);
      try {
        await finalize(job.id, 'failed', {}, msg);
      } catch { /* best-effort */ }
    }
  }

  console.log(`[orchestrator] done — processed=${processed} t1_profile_dispatched=${t1JobsCreated}`);
  return { processed, t1JobsCreated };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main() {
  const sweep = process.argv.includes('--sweep');
  const kindIdx = process.argv.indexOf('--kind');
  const kindFilter = kindIdx >= 0 ? process.argv[kindIdx + 1] : undefined;
  const childJobIdx = process.argv.indexOf('--child-job');
  const childJobId = childJobIdx >= 0 ? process.argv[childJobIdx + 1] : undefined;

  const org = await getDefaultOrg();
  const orgId = process.env.ORG_ID ?? org.id;

  console.log(`[orchestrator] starting  org=${orgId} sweep=${sweep}${kindFilter ? ` kind=${kindFilter}` : ''}${childJobId ? ` child-job=${childJobId}` : ''}`);

  // Advisory lock for t4_scan: prevents two overlapping coordinator runs from
  // each scanning the estate and creating duplicate child job trees.
  // Other job kinds rely on SELECT FOR UPDATE SKIP LOCKED in claimNext() for
  // per-job deduplication — that is insufficient for t4_scan which is a
  // coordinator that spawns children and must not overlap at the run level.
  if (kindFilter === 't4_scan') {
    const lock = await acquireOrchestratorLock(orgId, 't4_scan');
    if (!lock.acquired) {
      console.log('[orchestrator] t4_scan skipped: locked by another process');
      process.exit(0);
    }
    try {
      await runOrchestratorLoop(orgId, { kindFilter });
    } finally {
      await lock.release();
    }
    return;
  }

  await runOrchestratorLoop(orgId, { sweep, kindFilter, childJobId });
}

// Guard so the CLI block doesn't fire when imported by verify-ch4.ts
if (require.main === module) {
  main()
    .catch((e) => { console.error('[orchestrator] fatal:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
