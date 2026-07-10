import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import {
  enqueue,
  enqueueWithChildren,
  planSplit,
  launchChildTask,
  MAX_CONCURRENT_TASKS,
  MAX_CONCURRENT_BY_KIND,
  type JobKind,
} from '@/lib/context/queue';

export const dynamic = 'force-dynamic';

const ECS_CLUSTER = 'aloft-agents-prod';
const TASK_DEFINITION = 'aloft-context-harvester';
const CONTAINER_NAME = 'context-harvester';
const SUBNETS = ['subnet-03ee2945ebdafd883', 'subnet-0a6a530408b9e906a'];
const SECURITY_GROUPS = ['sg-04f5d2b63c1efd690'];
const REGION = 'ap-south-1';

const BASE_COMMAND = [
  'npx',
  'tsx',
  '--require',
  './scripts/context/noserver.cjs',
  'scripts/context/orchestrator.ts',
];

const VALID_KINDS: JobKind[] = [
  'change_detect',
  't0_structural',
  't1_profile',
  't2_semantic',
  'embed',
  'mapping',
  'silo_scan',
  'recompute_entity_tags',
  'estate_inventory',
  'knowledge_sync',
  't3_usage',
  't4_scan',
];

// Kinds that support auto-splitting (have objects-per-minute rates and benefit from partitioning)
const SPLITTABLE_KINDS = new Set<JobKind>(['t0_structural', 't1_profile', 't2_semantic']);

/**
 * Launch a Fargate task for a single job kind (non-split path).
 * Enqueues one job row per source, then starts one container.
 */
async function launchKind(
  kind: JobKind,
  orgId: string,
  sources: { id: string }[],
  excludeSchemas: string[],
  includePatterns: string[],
  chain: JobKind[],
): Promise<{ jobsEnqueued: number; taskArn: string | null; failures: { arn?: string; reason?: string }[] }> {
  const scope: Record<string, unknown> = {};
  if (excludeSchemas.length > 0) scope.excludeSchemas = excludeSchemas;
  if (includePatterns.length > 0) scope.includePatterns = includePatterns;
  if (chain.length > 0) scope.chain = chain;
  const scopeOrNull = Object.keys(scope).length > 0 ? scope : null;

  let jobsEnqueued = 0;
  const sourceIds: (string | null)[] = [];
  if (['t0_structural', 't1_profile', 't2_semantic', 'embed', 'estate_inventory', 't3_usage'].includes(kind)) {
    for (const src of sources) {
      await enqueue(kind, src.id, scopeOrNull, 'on_demand', orgId);
      sourceIds.push(src.id);
      jobsEnqueued++;
    }
  } else {
    const sid = sources[0]?.id ?? null;
    await enqueue(kind, sid, scopeOrNull, 'on_demand', orgId);
    sourceIds.push(sid);
    jobsEnqueued++;
  }

  const ecs = new ECSClient({ region: REGION });
  const result = await ecs.send(
    new RunTaskCommand({
      cluster: ECS_CLUSTER,
      taskDefinition: TASK_DEFINITION,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: SUBNETS,
          securityGroups: SECURITY_GROUPS,
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [{ name: CONTAINER_NAME, command: [...BASE_COMMAND, '--kind', kind] }],
      },
    }),
  );

  const taskArn = result.tasks?.[0]?.taskArn ?? null;
  const taskId = taskArn ? taskArn.split('/').pop() : null;

  if (taskId) {
    // Merge fargate_task_id into the existing scope using JSONB || so we don't
    // clobber continuation-job fields like `since` and `until`.
    const sourceFilter = sourceIds.filter(Boolean) as string[];
    if (sourceFilter.length > 0) {
      await prisma.$executeRaw`
        UPDATE platform_context_jobs
        SET scope = COALESCE(scope, '{}'::jsonb) || jsonb_build_object('fargate_task_id', ${taskId}::text)
        WHERE org_id = ${orgId}
          AND job_kind = ${kind}
          AND status = 'queued'
          AND parent_job_id IS NULL
          AND source_id = ANY(${sourceFilter}::uuid[])
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE platform_context_jobs
        SET scope = COALESCE(scope, '{}'::jsonb) || jsonb_build_object('fargate_task_id', ${taskId}::text)
        WHERE org_id = ${orgId}
          AND job_kind = ${kind}
          AND status = 'queued'
          AND parent_job_id IS NULL
      `;
    }
  }

  return {
    jobsEnqueued,
    taskArn,
    failures: (result.failures ?? []).map(f => ({ arn: f.arn, reason: f.reason })),
  };
}

/**
 * Launch a split job: creates parent + N child jobs, then starts up to MAX_CONCURRENT
 * Fargate tasks immediately. The remaining children stay queued and are picked up
 * by advanceChildren() in the orchestrator as earlier tasks complete.
 */
async function launchSplitKind(
  kind: JobKind,
  orgId: string,
  sourceId: string,
  excludeSchemas: string[],
  includePatterns: string[],
  chain: JobKind[],
): Promise<{
  parentJobId: string;
  totalChildren: number;
  tasksLaunched: number;
  taskArns: (string | null)[];
  failures: { arn?: string; reason?: string }[];
}> {
  // Plan the split
  const plan = await planSplit(orgId, kind, sourceId, { excludeSchemas, includePatterns });

  const baseScope: Record<string, unknown> = {};
  if (excludeSchemas.length > 0) baseScope.excludeSchemas = excludeSchemas;
  if (includePatterns.length > 0) baseScope.includePatterns = includePatterns;
  if (chain.length > 0) baseScope.chain = chain;

  // Create parent + child job rows atomically
  const { parentJobId, childJobIds } = await enqueueWithChildren(
    orgId,
    kind,
    sourceId,
    plan,
    baseScope,
    'on_demand',
  );

  // Launch up to MAX_CONCURRENT Fargate tasks immediately
  const maxConcurrent = (MAX_CONCURRENT_BY_KIND as Record<string, number>)[kind] ?? MAX_CONCURRENT_TASKS;
  const toLaunch = childJobIds.slice(0, maxConcurrent);

  const taskArns: (string | null)[] = [];
  const failures: { arn?: string; reason?: string }[] = [];

  await Promise.all(
    toLaunch.map(async (childId) => {
      try {
        const taskId = await launchChildTask(childId, kind, orgId);
        taskArns.push(taskId ? `arn:aws:ecs:${REGION}:454073573537:task/${TASK_DEFINITION}/${taskId}` : null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({ reason: msg });
        taskArns.push(null);
      }
    }),
  );

  return {
    parentJobId,
    totalChildren: childJobIds.length,
    tasksLaunched: toLaunch.length,
    taskArns,
    failures,
  };
}

/**
 * POST /api/agent-lab/context/jobs/launch
 *
 * Enqueue jobs for the given kind(s), then launch Fargate task(s).
 * For splittable kinds (T0/T1/T2) with large scopes, auto-splits into child jobs.
 * In sequential mode only the first kind is launched now; the orchestrator
 * auto-enqueues the next tier via job.scope.chain on completion.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json();

  const rawKinds: string[] = body.kinds
    ? (Array.isArray(body.kinds) ? body.kinds : [body.kinds])
    : body.kind
      ? [body.kind]
      : [];

  const excludeSchemas: string[] = Array.isArray(body.excludeSchemas) ? body.excludeSchemas : [];
  const includePatterns: string[] = Array.isArray(body.includePatterns) ? body.includePatterns : [];
  const sequential: boolean = body.sequential === true;

  const kinds = rawKinds.filter(k => VALID_KINDS.includes(k as JobKind)) as JobKind[];
  if (kinds.length === 0) {
    return NextResponse.json({ error: 'INVALID_KIND', valid: VALID_KINDS }, { status: 400 });
  }

  try {
    const orgId = await getOrgId();
    const sources = await prisma.platformContextSource.findMany({
      where: { org_id: orgId, status: 'active' },
      select: { id: true },
    });

    let totalJobsEnqueued = 0;
    let allFailures: { arn?: string; reason?: string }[] = [];
    const taskArns: (string | null)[] = [];
    const splitSummaries: { kind: string; parentJobId: string; totalChildren: number }[] = [];

    const launchOne = async (kind: JobKind, chain: JobKind[]) => {
      // Check if this kind benefits from splitting and has a source with objects
      const sourceId = sources[0]?.id;
      if (SPLITTABLE_KINDS.has(kind) && sourceId) {
        // Check scope size: count objects that would be processed
        const plan = await planSplit(orgId, kind, sourceId, { excludeSchemas, includePatterns });

        if (plan.needsSplit) {
          const result = await launchSplitKind(kind, orgId, sourceId, excludeSchemas, includePatterns, chain);
          splitSummaries.push({ kind, parentJobId: result.parentJobId, totalChildren: result.totalChildren });
          totalJobsEnqueued += result.totalChildren + 1; // children + parent
          allFailures.push(...result.failures);
          taskArns.push(...result.taskArns);
          return;
        }
      }

      // Non-split path
      const result = await launchKind(kind, orgId, sources, excludeSchemas, includePatterns, chain);
      totalJobsEnqueued += result.jobsEnqueued;
      allFailures.push(...result.failures);
      if (result.taskArn) taskArns.push(result.taskArn);
    };

    if (sequential && kinds.length > 1) {
      const [firstKind, ...rest] = kinds;
      await launchOne(firstKind, rest);
    } else {
      await Promise.all(kinds.map(kind => launchOne(kind, [])));
    }

    if (allFailures.length > 0) {
      console.error('[jobs/launch] Fargate failures:', allFailures);
      return NextResponse.json(
        { error: 'FARGATE_LAUNCH_FAILED', failures: allFailures, jobs_enqueued: totalJobsEnqueued },
        { status: 502 },
      );
    }

    return NextResponse.json({
      status: 'launched',
      kinds,
      sequential,
      jobs_enqueued: totalJobsEnqueued,
      task_arns: taskArns,
      split_summaries: splitSummaries.length > 0 ? splitSummaries : undefined,
    });
  } catch (err) {
    console.error('[context/jobs/launch POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
