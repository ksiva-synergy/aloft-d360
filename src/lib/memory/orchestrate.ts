/**
 * Memory DAG Orchestrator — runs job sequences with session-scoped advisory
 * locking and run-log heartbeat.
 *
 * Two DAG groups:
 *   NIGHTLY = [synthesize, reclassify?]  — fires daily at 04:30 UTC.
 *                                           reclassify only runs when topic
 *                                           coverage drops below COVERAGE_TARGET.
 *   WEEKLY  = [grow_refine, reclassify] — fires Sunday 05:30 UTC.
 *                                          reclassify always runs weekly to keep
 *                                          topic labels fresh.
 */

import { createId } from '@paralleldrive/cuid2';
import { prisma } from '@/lib/prisma';
import { acquireOrchestratorLock } from '@/lib/memory/lock';
import { runSynthesisSweep } from '@/lib/memory/run-sweep';
import { refineMemoryStore } from '@/lib/memory/synthesis';
import { runCluster, shouldReclassify, COVERAGE_TARGET } from '@/lib/foer/run-cluster';
import { currentPeriod } from '@/lib/foer/topics';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DagGroup = 'nightly' | 'weekly';

export interface JobResult {
  itemsProcessed: number;
}

type JobFn = (orgId: string) => Promise<JobResult>;

// ── Test hook: injectable delay for concurrency verification ──────────────────

let _testDelayMs = 0;
export function _setTestDelay(ms: number): void { _testDelayMs = ms; }

// ── Coverage read — lightweight inline query matching stats.ts flagStatus ─────

async function readCoveragePercent(orgId: string): Promise<number> {
  const [totalRows, assignedRows] = await Promise.all([
    prisma.platformAgentMemory.findMany({
      where:    { orgId, status: 'ACTIVE', taskSignature: { not: null } },
      select:   { taskSignature: true },
      distinct: ['taskSignature'],
    }),
    prisma.platformMemoryTopic.findMany({
      where:  { orgId, period: currentPeriod(), taskSignature: { not: '' } },
      select: { taskSignature: true },
      distinct: ['taskSignature'],
    }),
  ]);
  const total    = totalRows.length;
  const assigned = assignedRows.length;
  return total > 0 ? Math.round((assigned / total) * 100) : 100;
}

// ── Job Registry ──────────────────────────────────────────────────────────────

const JOB_REGISTRY: Record<string, JobFn> = {
  synthesize: async (orgId) => {
    const summary = await runSynthesisSweep(orgId, null);
    return { itemsProcessed: summary.sessionsReflected };
  },
  grow_refine: async (orgId) => {
    const result = await refineMemoryStore(orgId);
    return { itemsProcessed: result.deduped + result.expired + result.gcRemoved };
  },
  reclassify: async (orgId) => {
    const mockNames = process.env.MEMORY_MOCK_CLUSTER === 'true';
    const result = await runCluster({ orgId, mockNames });
    if (!result.ok) throw new Error(result.error ?? 'runCluster returned ok=false');
    return { itemsProcessed: result.signaturesAssigned };
  },
};

// ── DAG Definitions ───────────────────────────────────────────────────────────

// Weekly DAG: grow_refine first (de-dup, TTL decay, GC), then reclassify to
// refresh topic labels against the pruned store.
const DAG_STEPS: Record<DagGroup, string[]> = {
  nightly: ['synthesize'],       // reclassify appended conditionally after synthesize — see runDag
  weekly:  ['grow_refine', 'reclassify'],
};

// ── Run a single job with heartbeat logging ──────────────────────────────────

async function runJob(
  orgId: string,
  runGroupId: string,
  jobKey: string,
): Promise<'ok' | 'error'> {
  const fn = JOB_REGISTRY[jobKey];
  if (!fn) {
    console.error(`[orchestrate] unknown job_key: ${jobKey}`);
    return 'error';
  }

  const rowId = createId();
  const startedAt = new Date();

  await prisma.platformJobRun.create({
    data: { id: rowId, orgId, runGroupId, jobKey, status: 'running', startedAt },
  });

  try {
    if (_testDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, _testDelayMs));
    }

    const result = await fn(orgId);

    await prisma.platformJobRun.update({
      where: { id: rowId },
      data: {
        status: 'ok',
        finishedAt: new Date(),
        itemsProcessed: result.itemsProcessed,
      },
    });

    console.log(`[orchestrate] ${jobKey} OK  items=${result.itemsProcessed}`);
    return 'ok';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    await prisma.platformJobRun.update({
      where: { id: rowId },
      data: {
        status: 'error',
        finishedAt: new Date(),
        errorText: msg.slice(0, 2000),
      },
    });

    console.error(`[orchestrate] ${jobKey} ERROR: ${msg}`);
    return 'error';
  }
}

// ── DAG Runner ────────────────────────────────────────────────────────────────

export interface DagResult {
  runGroupId: string;
  group: DagGroup;
  locked: boolean;
  steps: Array<{ jobKey: string; status: 'ok' | 'error' | 'skipped' }>;
}

/**
 * Run a DAG group end-to-end. Acquires a session-scoped advisory lock on a
 * dedicated connection — held for the full duration of the DAG, released in
 * a finally block. If the lock is unavailable, logs "skipped: locked" and
 * exits cleanly.
 *
 * Nightly coverage-drop trigger: after synthesize completes successfully,
 * reads current topic coverage. If shouldReclassify() returns true (coverage
 * < COVERAGE_TARGET), reclassify is appended as an extra nightly step. This
 * runs inside the same advisory lock as synthesize — no second lock needed.
 */
export async function runDag(orgId: string, group: DagGroup): Promise<DagResult> {
  const runGroupId = createId();
  const steps = [...DAG_STEPS[group]];

  const lock = await acquireOrchestratorLock(orgId, group);

  if (!lock.acquired) {
    console.log(`[orchestrate] ${group} skipped: locked by another process`);
    return { runGroupId, group, locked: true, steps: steps.map(s => ({ jobKey: s, status: 'skipped' as const })) };
  }

  try {
    console.log(`[orchestrate] ${group} DAG starting  runGroupId=${runGroupId}`);

    const results: DagResult['steps'] = [];

    for (const jobKey of steps) {
      const status = await runJob(orgId, runGroupId, jobKey);
      results.push({ jobKey, status });

      if (status === 'error') {
        for (const remaining of steps.slice(steps.indexOf(jobKey) + 1)) {
          results.push({ jobKey: remaining, status: 'skipped' });
        }
        break;
      }

      // Nightly coverage-drop trigger: after synthesize succeeds, check whether
      // reclassify should run inline to restore topic coverage.
      if (group === 'nightly' && jobKey === 'synthesize' && status === 'ok') {
        const coveragePercent = await readCoveragePercent(orgId);
        if (shouldReclassify({ coveragePercent, target: COVERAGE_TARGET * 100 })) {
          console.log(
            `[orchestrate] nightly coverage=${coveragePercent}% < ${COVERAGE_TARGET * 100}% — appending reclassify`,
          );
          const reclassifyStatus = await runJob(orgId, runGroupId, 'reclassify');
          results.push({ jobKey: 'reclassify', status: reclassifyStatus });
        } else {
          console.log(`[orchestrate] nightly coverage=${coveragePercent}% — reclassify skipped`);
        }
      }
    }

    console.log(
      `[orchestrate] ${group} DAG complete  runGroupId=${runGroupId}` +
      `  results=${results.map(r => `${r.jobKey}:${r.status}`).join(', ')}`,
    );

    return { runGroupId, group, locked: false, steps: results };
  } finally {
    await lock.release();
  }
}
