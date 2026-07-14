import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import type { PlatformContextJob } from '@prisma/client';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { deriveT2CostPerObject } from './cost-model';

export type JobKind =
  | 'change_detect'
  | 't0_structural'
  | 't1_profile'
  | 't2_semantic'
  | 'embed'
  | 'mapping'
  | 'silo_scan'
  | 't3_connected'
  | 't3_usage'
  | 'recompute_entity_tags'
  | 'estate_inventory'
  | 'knowledge_sync'
  | 't4_scan'
  | 't4_entity_propose'
  | 't4_dim_propose';

export type TriggerKind = 'scheduled' | 'on_demand' | 'on_connect';

// ── Auto-split tuning constants ───────────────────────────────────────────────
// Phase 1: 15 min budget. Graduate by bumping TIME_BUDGET_MINUTES → 30 → 60 → 120.
// No other code changes needed between phases.
export const TIME_BUDGET_MINUTES = 15;
export const MAX_CONCURRENT_TASKS = 5;

// Observed throughput rates (objects per minute per tier)
export const RATE_PER_MINUTE: Record<string, number> = {
  t0_structural: 1000,
  t1_profile: 25,
  t2_semantic: 33,
  t4_entity_propose: 10,  // 1 Bedrock Sonnet call per cluster, ~3-4s each; 33/min would be below call duration
  t4_dim_propose: 20,     // smaller single-entity calls, ~1.5-2s each
};

// Number of recent succeeded t2_semantic jobs to average when deriving per-object cost.
const T2_COST_SAMPLE_SIZE = 20;

/**
 * Derive the per-object T2 cost (USD) from a rolling average of recent succeeded
 * t2_semantic jobs, reading platform_context_jobs.stats.cost_usd and
 * stats.objects_enriched (stats keys written by enrich.ts). Uses the last
 * ~20 such jobs and computes avg(cost_usd / objects_enriched); falls back to a
 * corrected constant (~$0.07/object, measured) when there are too few samples.
 *
 * Only top-level jobs (parent_job_id IS NULL) are sampled so split parents are
 * counted once against their aggregated stats rather than double-counted with
 * their children.
 */
export async function estimateT2CostPerObject(orgId: string): Promise<number> {
  const recent = await prisma.platformContextJob.findMany({
    where: {
      org_id: orgId,
      job_kind: 't2_semantic',
      status: 'succeeded',
      parent_job_id: null,
    },
    orderBy: { finished_at: 'desc' },
    select: { stats: true },
    take: T2_COST_SAMPLE_SIZE,
  });

  const statsList = recent.map((job) =>
    job.stats && typeof job.stats === 'object' && !Array.isArray(job.stats)
      ? (job.stats as Record<string, unknown>)
      : null,
  );

  return deriveT2CostPerObject(statsList);
}

// Maximum concurrent Fargate tasks for each tier
export const MAX_CONCURRENT_BY_KIND: Record<string, number> = {
  t0_structural: 5,
  t1_profile: 5,
  t2_semantic: parseInt(process.env.T2_MAX_CONCURRENT ?? '5'),
  t4_scan: 1,
  t4_entity_propose: 2,  // reduced from 5 — each spawns up to 5 dim tasks; 2×5=10 RunTask burst max
  t4_dim_propose: 5,     // reduced from 10 — limits ec2:DescribeSecurityGroups burst per advance call
};

// ── ECS constants (mirrored from launch route and orchestrator) ───────────────
// Exported so executor.ts (MX4a) can reuse without duplication.
export const ECS_CLUSTER = 'aloft-agents-prod';
export const TASK_DEFINITION = 'aloft-context-harvester';
export const CONTAINER_NAME = 'context-harvester';
export const SUBNETS = ['subnet-03ee2945ebdafd883', 'subnet-0a6a530408b9e906a'];
export const SECURITY_GROUPS = ['sg-04f5d2b63c1efd690'];
export const REGION = 'ap-south-1';
export const BASE_COMMAND = [
  'npx', 'tsx',
  '--require', './scripts/context/noserver.cjs',
  'scripts/context/orchestrator.ts',
];

// ── Core queue operations ─────────────────────────────────────────────────────

/** Insert a new queued job row and return it. */
export async function enqueue(
  jobKind: JobKind,
  sourceId: string | null,
  scope: Record<string, unknown> | null,
  trigger: TriggerKind,
  orgId: string,
): Promise<PlatformContextJob> {
  return prisma.platformContextJob.create({
    data: {
      org_id: orgId,
      source_id: sourceId,
      job_kind: jobKind,
      trigger,
      status: 'queued',
      ...(scope !== null ? { scope: scope as Prisma.InputJsonValue } : {}),
    },
  });
}

/**
 * Claim the oldest queued job for this org atomically.
 * Uses SELECT FOR UPDATE SKIP LOCKED so concurrent callers never double-claim.
 * Returns null when the queue is empty.
 * Optionally filter by job_kind.
 */
export async function claimNext(orgId: string, kindFilter?: string): Promise<PlatformContextJob | null> {
  while (true) {
    const job = await prisma.$transaction(async (tx) => {
      const kindClause = kindFilter
        ? `AND job_kind = '${kindFilter}'`
        : '';
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM platform_context_jobs
         WHERE org_id = $1
           AND status = 'queued'
           AND parent_job_id IS NULL
           ${kindClause}
         ORDER BY created_at ASC NULLS LAST, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        orgId,
      );
      if (rows.length === 0) return null;

      return tx.platformContextJob.update({
        where: { id: rows[0].id },
        data: { status: 'running', started_at: new Date() },
      });
    });

    if (!job) return null;

    if (job.job_kind === 'silo_scan' || job.job_kind === 'recompute_entity_tags') {
      dispatchJob(job).catch((err) => {
        console.error(`Error in background dispatch for job ${job.id}:`, err);
      });
      continue;
    }

    return job;
  }
}

/**
 * Claim the oldest queued child job for a specific parent atomically.
 * Used by the orchestrator after a child completes to pick up the next one.
 */
export async function claimNextChild(
  parentJobId: string,
  orgId: string,
  kindFilter?: string,
): Promise<PlatformContextJob | null> {
  const kindClause = kindFilter ? `AND job_kind = '${kindFilter}'` : '';
  const result = await prisma.$transaction(async (tx) => {
    const found = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM platform_context_jobs
       WHERE org_id = $1
         AND parent_job_id = $2::uuid
         AND status = 'queued'
         ${kindClause}
       ORDER BY child_index ASC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      orgId,
      parentJobId,
    );
    if (found.length === 0) return null;

    return tx.platformContextJob.update({
      where: { id: found[0].id },
      data: { status: 'running', started_at: new Date() },
    });
  });
  return result ?? null;
}

async function dispatchJob(job: PlatformContextJob): Promise<void> {
  const orgId = job.org_id;
  const scope = (job.scope ?? {}) as Record<string, any>;
  try {
    if (job.job_kind === 'silo_scan') {
      const { runSiloScan } = await import('./silo');
      const objectId = scope.objectId;
      const topN = scope.topN;
      const minScore = scope.minScore;
      const includeRejected = scope.includeRejected;
      if (!objectId) {
        await finalize(job.id, 'failed', {}, 'Missing objectId in silo_scan job scope');
        return;
      }
      await runSiloScan(objectId, orgId, { topN, minScore, includeRejected, jobId: job.id });
    } else if (job.job_kind === 'recompute_entity_tags') {
      const { computeEntityTags } = await import('./mapping');
      await computeEntityTags(orgId);
      await finalize(job.id, 'succeeded', {});
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalize(job.id, 'failed', {}, msg);
  }
}

/** Refresh updated_at to signal the job is still alive. */
export async function heartbeat(jobId: string): Promise<void> {
  await prisma.platformContextJob.update({
    where: { id: jobId },
    data: { updated_at: new Date() },
  });
}

/** Default heartbeat cadence: refresh at most once every 3 minutes, giving at
 * least ~6 refreshes inside the 30-minute failStale() window even at the
 * highest graduated time budget. */
export const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Build a throttled, best-effort heartbeat callback for a tier-runner work loop.
 * Call the returned function once per iteration; it refreshes updated_at only
 * after `intervalMs` has elapsed since the last refresh — so a healthy-but-slow
 * job stays clearly inside the failStale() window without a DB write per object.
 *
 * A no-op when jobId is undefined: the standalone (non-orchestrated) path owns
 * its own row and is not reaped by the orchestrator, so it needs no heartbeat.
 * Heartbeat failures are swallowed so a transient DB blip never kills live work
 * (the next tick retries; a persistent failure means the job is doomed anyway).
 */
export function makeHeartbeat(
  jobId: string | undefined,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): () => Promise<void> {
  let last = Date.now();
  return async () => {
    if (!jobId) return;
    if (Date.now() - last < intervalMs) return;
    last = Date.now();
    try {
      await heartbeat(jobId);
    } catch (err) {
      console.error(`[heartbeat] failed for job ${jobId}:`, err);
    }
  };
}

/**
 * Mark running jobs that have missed heartbeats as failed.
 * Called at orchestrator startup to reap abandoned work from crashed containers.
 * Returns the count of rows updated.
 */
export async function failStale(maxAgeMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  const errorMsg = `reaped: no heartbeat within ${maxAgeMinutes} minutes`;
  // Include child jobs (parent_job_id IS NOT NULL) — previously only top-level
  // jobs were reaped, leaving OOM-killed T4 child jobs as zombie 'running' rows
  // indefinitely and feeding the duplicate-launch loop in advanceChildren.
  const result = await prisma.platformContextJob.updateMany({
    where: {
      status: 'running',
      OR: [{ updated_at: null }, { updated_at: { lt: cutoff } }],
    },
    data: {
      status: 'failed',
      error: errorMsg,
      finished_at: new Date(),
      updated_at: new Date(),
    },
  });
  return result.count;
}

/** Write final status, stats JSONB, and optional error to a job row. */
export async function finalize(
  jobId: string,
  status: 'succeeded' | 'failed' | 'partial',
  stats: Record<string, unknown>,
  error?: string,
): Promise<void> {
  await prisma.platformContextJob.update({
    where: { id: jobId },
    data: {
      status,
      finished_at: new Date(),
      stats: stats as Prisma.InputJsonValue,
      ...(error !== undefined ? { error } : {}),
    },
  });
}

// ── Auto-split: planner ───────────────────────────────────────────────────────

export interface SplitPartition {
  /** Disambiguated schema key in form "catalog.schema" */
  schemaKey: string;
  catalog: string;
  schema: string;
  /** object names scoped to this partition (empty = all in schema) */
  objectNames: string[];
  objectCount: number;
}

export interface SplitPlan {
  /** whether a split is needed at all */
  needsSplit: boolean;
  partitions: SplitPartition[];
  maxObjectsPerChild: number;
  estimatedMinutesPerChild: number;
  estimatedWallClockMinutes: number;
  estimatedCostUsd: number;
  totalObjects: number;
}

/**
 * Plan how to split a large job scope into time-budget-bounded partitions.
 * Groups objects by schema first; further splits large schemas alphabetically.
 */
export async function planSplit(
  orgId: string,
  kind: JobKind,
  sourceId: string,
  opts: {
    excludeSchemas?: string[];
    includePatterns?: string[];
  },
): Promise<SplitPlan> {
  const rate = RATE_PER_MINUTE[kind] ?? 25;
  const maxObjectsPerChild = Math.floor(rate * TIME_BUDGET_MINUTES);

  // Per-object LLM cost — derived from a rolling average of recent t2 jobs, with a
  // measured-constant fallback. Only meaningful for t2_semantic; other tiers are $0.
  const costPerObject = kind === 't2_semantic'
    ? await estimateT2CostPerObject(orgId)
    : 0;

  // Fetch distinct catalog+schema combos with object counts
  const rows = await prisma.$queryRawUnsafe<Array<{ catalog_name: string; schema_name: string; cnt: bigint }>>(
    `SELECT catalog_name, schema_name, COUNT(*) AS cnt
     FROM platform_context_objects
     WHERE org_id = $1
       AND source_id = $2::uuid
       AND lifecycle = 'active'
     GROUP BY catalog_name, schema_name
     ORDER BY catalog_name, schema_name`,
    orgId,
    sourceId,
  );

  // Apply excludeSchemas filter
  const excludeSet = new Set(opts.excludeSchemas ?? []);
  const filtered = rows.filter(r => {
    const key = `${r.catalog_name}.${r.schema_name}`;
    return !excludeSet.has(key) && !excludeSet.has(r.schema_name);
  });

  const totalObjects = filtered.reduce((s, r) => s + Number(r.cnt), 0);

  // Determine if split is needed
  if (totalObjects <= maxObjectsPerChild) {
    return {
      needsSplit: false,
      partitions: [],
      maxObjectsPerChild,
      estimatedMinutesPerChild: TIME_BUDGET_MINUTES,
      estimatedWallClockMinutes: Math.ceil(totalObjects / rate),
      estimatedCostUsd: totalObjects * costPerObject,
      totalObjects,
    };
  }

  // Build partitions
  const partitions: SplitPartition[] = [];

  for (const row of filtered) {
    const cnt = Number(row.cnt);
    const schemaKey = `${row.catalog_name}.${row.schema_name}`;

    if (cnt <= maxObjectsPerChild) {
      partitions.push({
        schemaKey,
        catalog: row.catalog_name,
        schema: row.schema_name,
        objectNames: [],
        objectCount: cnt,
      });
    } else {
      // Schema exceeds child cap — fetch object names and split alphabetically
      const objects = await prisma.platformContextObject.findMany({
        where: {
          org_id: orgId,
          source_id: sourceId,
          catalog_name: row.catalog_name,
          schema_name: row.schema_name,
          lifecycle: 'active',
        },
        select: { object_name: true },
        orderBy: { object_name: 'asc' },
      });

      const names = objects.map(o => o.object_name ?? '').filter(Boolean);
      for (let i = 0; i < names.length; i += maxObjectsPerChild) {
        const slice = names.slice(i, i + maxObjectsPerChild);
        partitions.push({
          schemaKey: `${schemaKey}[${i / maxObjectsPerChild}]`,
          catalog: row.catalog_name,
          schema: row.schema_name,
          objectNames: slice,
          objectCount: slice.length,
        });
      }
    }
  }

  const maxConcurrent = MAX_CONCURRENT_BY_KIND[kind] ?? MAX_CONCURRENT_TASKS;
  const waves = Math.ceil(partitions.length / maxConcurrent);
  const estimatedWallClockMinutes = waves * TIME_BUDGET_MINUTES;

  return {
    needsSplit: true,
    partitions,
    maxObjectsPerChild,
    estimatedMinutesPerChild: TIME_BUDGET_MINUTES,
    estimatedWallClockMinutes,
    estimatedCostUsd: totalObjects * costPerObject,
    totalObjects,
  };
}

// ── Auto-split: enqueue parent + children ────────────────────────────────────

export interface EnqueueWithChildrenResult {
  parentJobId: string;
  childJobIds: string[];
  totalChildren: number;
}

/**
 * Atomically create a parent job (status=orchestrating) and all child jobs (status=queued).
 * Returns the parent job ID and the list of child IDs.
 */
export async function enqueueWithChildren(
  orgId: string,
  kind: JobKind,
  sourceId: string | null,
  plan: SplitPlan,
  baseScope: Record<string, unknown>,
  trigger: TriggerKind,
): Promise<EnqueueWithChildrenResult> {
  return prisma.$transaction(async (tx) => {
    // Create parent job with status=orchestrating
    const parent = await tx.platformContextJob.create({
      data: {
        org_id: orgId,
        source_id: sourceId,
        job_kind: kind,
        trigger,
        status: 'orchestrating',
        scope: {
          ...baseScope,
          is_parent: true,
          total_children: plan.partitions.length,
          time_budget_minutes: TIME_BUDGET_MINUTES,
        } as Prisma.InputJsonValue,
      },
    });

    const childJobIds: string[] = [];

    for (let i = 0; i < plan.partitions.length; i++) {
      const partition = plan.partitions[i];
      const childScope: Record<string, unknown> = {
        ...baseScope,
        parent_job_id: parent.id,
        child_index: i,
        // Scope for the harvester: restrict to this catalog.schema
        partition_catalog: partition.catalog,
        partition_schema: partition.schema,
      };

      // If we further split a large schema alphabetically, include explicit object list
      if (partition.objectNames.length > 0) {
        childScope.partition_objects = partition.objectNames;
      }

      // Pass chain from baseScope into children so sequential chaining still works
      if (Array.isArray(baseScope.chain) && (baseScope.chain as string[]).length > 0) {
        childScope.chain = baseScope.chain;
      }

      const child = await tx.platformContextJob.create({
        data: {
          org_id: orgId,
          source_id: sourceId,
          job_kind: kind,
          trigger,
          status: 'queued',
          parent_job_id: parent.id,
          child_index: i,
          scope: childScope as Prisma.InputJsonValue,
        },
      });

      childJobIds.push(child.id);
    }

    return { parentJobId: parent.id, childJobIds, totalChildren: plan.partitions.length };
  });
}

// ── Auto-split: child completion → advance queue ──────────────────────────────

/**
 * Called after a child job completes.
 * - Checks how many siblings are still running vs queued
 * - Launches a new Fargate task for each queued slot within MAX_CONCURRENT
 * - When all children are terminal, calls finalizeParent
 *
 * Returns the number of new tasks launched.
 */
export async function advanceChildren(
  parentJobId: string,
  orgId: string,
  kind: JobKind,
): Promise<{ launched: number; parentFinalized: boolean }> {
  const ecs = new ECSClient({ region: REGION });
  const maxConcurrent = MAX_CONCURRENT_BY_KIND[kind] ?? MAX_CONCURRENT_TASKS;
  // Stagger RunTask calls to avoid bursting ec2:DescribeSecurityGroups (rate-limited per-account).
  // 600ms between launches keeps a 5-task batch spread over 3s instead of instant.
  const LAUNCH_STAGGER_MS = 600;

  // Reap stale child jobs for this parent before counting slots.
  // failStale() previously only reaped top-level jobs (parent_job_id IS NULL),
  // so OOM-killed T4 children accumulated as zombie 'running' rows indefinitely
  // and starved the concurrency slots. Calling it here ensures zombies are
  // flushed to 'failed' on every advanceChildren invocation, independent of
  // any orchestrator-task startup. (failStale now covers all running rows.)
  await failStale(30);

  // Count siblings by status
  const counts = await prisma.platformContextJob.groupBy({
    by: ['status'],
    where: { parent_job_id: parentJobId },
    _count: true,
  });

  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.status] = c._count;

  const running = byStatus['running'] ?? 0;
  const queued = byStatus['queued'] ?? 0;
  const total = Object.values(byStatus).reduce((s, v) => s + v, 0);
  const terminal = total - running - queued;

  // How many slots can we fill?
  const slotsAvailable = Math.max(0, maxConcurrent - running);
  let launched = 0;

  for (let i = 0; i < slotsAvailable && i < queued; i++) {
    // Claim a queued child and atomically mark it running in one transaction.
    // Previously the row was kept as 'queued' here and relied on the Fargate
    // task to flip it — the ~60s gap between launch and task startup allowed
    // concurrent advanceChildren callers (completing siblings) to re-claim the
    // same slot and launch a second Fargate task for the same job.
    const child = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM platform_context_jobs
         WHERE parent_job_id = $1::uuid
           AND status = 'queued'
         ORDER BY child_index ASC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        parentJobId,
      );
      if (rows.length === 0) return null;
      return tx.platformContextJob.update({
        where: { id: rows[0].id },
        data: { status: 'running', started_at: new Date(), updated_at: new Date() },
      });
    });

    if (!child) break;

    // Enforce a launch-attempts cap stored in scope.launch_attempts.
    // If RunTask fails for a structural reason (bad task def, IAM, ECR pull),
    // the row would roll back to queued and loop indefinitely. Cap at 3 attempts
    // then mark failed so the real error surfaces rather than silently hot-looping.
    const MAX_LAUNCH_ATTEMPTS = 3;
    const childScope = (child.scope ?? {}) as Record<string, unknown>;
    const launchAttempts = typeof childScope.launch_attempts === 'number' ? childScope.launch_attempts : 0;
    if (launchAttempts >= MAX_LAUNCH_ATTEMPTS) {
      await prisma.platformContextJob.update({
        where: { id: child.id },
        data: {
          status: 'failed',
          error: `Exceeded max launch attempts (${MAX_LAUNCH_ATTEMPTS}) — RunTask may have a structural error`,
          finished_at: new Date(),
          updated_at: new Date(),
        },
      });
      console.error(`[advanceChildren] job=${child.id} exceeded ${MAX_LAUNCH_ATTEMPTS} launch attempts — marking failed`);
      launched++; // count as "processed" so the slot isn't re-evaluated this pass
      continue;
    }

    // Increment attempt counter before launch so a crash between claim and
    // RunTask response doesn't lose the count.
    await prisma.platformContextJob.update({
      where: { id: child.id },
      data: {
        scope: { ...childScope, launch_attempts: launchAttempts + 1 } as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });

    // Launch a Fargate task for this child.
    // If RunTask fails after the atomic claim-to-running above, roll back the
    // row to 'queued' so it can be picked up by the next advanceChildren call
    // rather than becoming a zombie 'running' row with no associated task.
    let taskId: string | null = null;
    try {
      const result = await ecs.send(new RunTaskCommand({
        cluster: ECS_CLUSTER,
        taskDefinition: TASK_DEFINITION,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: { subnets: SUBNETS, securityGroups: SECURITY_GROUPS, assignPublicIp: 'ENABLED' },
        },
        overrides: {
          containerOverrides: [{
            name: CONTAINER_NAME,
            command: [...BASE_COMMAND, '--kind', kind, '--child-job', child.id],
          }],
        },
      }));
      taskId = result.tasks?.[0]?.taskArn?.split('/').pop() ?? null;
    } catch (launchErr) {
      console.error(`[advanceChildren] RunTask failed for job=${child.id} (attempt ${launchAttempts + 1}/${MAX_LAUNCH_ATTEMPTS}): ${launchErr instanceof Error ? launchErr.message : String(launchErr)}`);
      // Roll back to queued so next advanceChildren invocation can retry.
      // Keep the incremented launch_attempts in scope so the cap is respected.
      await prisma.platformContextJob.update({
        where: { id: child.id },
        data: { status: 'queued', started_at: null, updated_at: new Date() },
      });
      continue;
    }

    if (taskId) {
      await prisma.platformContextJob.update({
        where: { id: child.id },
        data: { scope: { ...childScope, launch_attempts: launchAttempts + 1, fargate_task_id: taskId } as Prisma.InputJsonValue },
      });
    }

    launched++;

    // Stagger to avoid ec2:DescribeSecurityGroups burst throttle
    if (i < slotsAvailable - 1 && i < queued - 1) {
      await new Promise(res => setTimeout(res, LAUNCH_STAGGER_MS));
    }
  }

  // Check if all children are now terminal (no running/queued left)
  const finalCounts = await prisma.platformContextJob.groupBy({
    by: ['status'],
    where: { parent_job_id: parentJobId },
    _count: true,
  });

  const finalByStatus: Record<string, number> = {};
  for (const c of finalCounts) finalByStatus[c.status] = c._count;

  const stillActive = (finalByStatus['running'] ?? 0) + (finalByStatus['queued'] ?? 0);
  let parentFinalized = false;

  if (stillActive === 0) {
    await finalizeParent(parentJobId);
    parentFinalized = true;
  }

  return { launched, parentFinalized };
}

/**
 * Aggregate child stats and set the parent job's final status.
 * Called automatically by advanceChildren when all children are terminal.
 */
export async function finalizeParent(parentJobId: string): Promise<void> {
  const children = await prisma.platformContextJob.findMany({
    where: { parent_job_id: parentJobId },
    select: { status: true, stats: true, error: true },
  });

  const succeeded = children.filter(c => c.status === 'succeeded').length;
  const failed = children.filter(c => c.status === 'failed').length;
  const partial = children.filter(c => c.status === 'partial').length;

  // Aggregate numeric stats from children
  const aggregated: Record<string, number> = {
    total_children: children.length,
    succeeded_children: succeeded,
    failed_children: failed,
    partial_children: partial,
  };

  for (const child of children) {
    if (child.stats && typeof child.stats === 'object' && !Array.isArray(child.stats)) {
      for (const [key, val] of Object.entries(child.stats as Record<string, unknown>)) {
        if (typeof val === 'number') {
          aggregated[key] = (aggregated[key] ?? 0) + val;
        }
      }
    }
  }

  const parentStatus: 'succeeded' | 'failed' | 'partial' =
    failed === children.length ? 'failed'
    : failed > 0 || partial > 0 ? 'partial'
    : 'succeeded';

  const errors = children
    .filter(c => c.error)
    .map(c => c.error as string)
    .join('\n');

  await prisma.platformContextJob.update({
    where: { id: parentJobId },
    data: {
      status: parentStatus,
      finished_at: new Date(),
      stats: aggregated as Prisma.InputJsonValue,
      ...(errors ? { error: errors } : {}),
    },
  });
}

// ── Helpers for the launch route ──────────────────────────────────────────────

/** Launch a Fargate task for a queued child job. */
export async function launchChildTask(
  childJobId: string,
  kind: JobKind,
  orgId: string,
): Promise<string | null> {
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
      containerOverrides: [{
        name: CONTAINER_NAME,
        command: [...BASE_COMMAND, '--kind', kind, '--child-job', childJobId],
      }],
    },
  }));

  const taskArn = result.tasks?.[0]?.taskArn ?? null;
  const taskId = taskArn ? taskArn.split('/').pop() : null;

  if (taskId) {
    const child = await prisma.platformContextJob.findUnique({ where: { id: childJobId } });
    if (child) {
      const scope = (child.scope ?? {}) as Record<string, unknown>;
      await prisma.platformContextJob.update({
        where: { id: childJobId },
        data: { scope: { ...scope, fargate_task_id: taskId } as Prisma.InputJsonValue },
      });
    }
  }

  return taskId ?? null;
}
