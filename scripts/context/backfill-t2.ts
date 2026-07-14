/**
 * WS8 — one-shot T2 semantic backfill.
 *
 * Finds every active context object that has no T2 semantic card yet (no
 * `assumed` row in platform_context_semantics — the ~1,703 uncovered objects),
 * enqueues one t2_semantic job per object via the normal queue mechanism, then
 * drains the queue in-process at T2_MAX_CONCURRENT using the exact orchestrator
 * dispatch path. Logs progress and exits cleanly once the queue is empty.
 *
 * Usage:
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/backfill-t2.ts [--dry-run]
 *
 * --dry-run   Print the object list that WOULD be enqueued and exit without
 *             enqueuing or processing anything.
 *
 * Env (loaded from .env.local by noserver.cjs): DATABASE_URL / DIRECT_URL,
 * DEFAULT_ORG_SLUG (or ORG_ID), BEDROCK_REGION, plus AWS credentials for Bedrock.
 */

import prisma from '@/lib/db';
import { enqueue, MAX_CONCURRENT_BY_KIND } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/platform/agents';
import { runOrchestratorLoop } from './orchestrator';

// Marker written into each enqueued job's scope so progress polling can isolate
// this backfill's jobs from any other t2_semantic work already in the queue.
const BACKFILL_TAG = 'ws8_t2_backfill';

// How often the progress reporter samples job-status counts (ms).
const PROGRESS_INTERVAL_MS = 15_000;

interface UncoveredObject {
  id: string;
  source_id: string;
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  last_t1_at: Date | null;
}

/**
 * Active objects with no T2 semantic card. A card is the `assumed`-status row
 * that T2 enrichment writes into platform_context_semantics (T3 usage writes
 * `observed` rows, which do NOT count as a card — see getCoverageSummary).
 */
async function findUncoveredObjects(orgId: string): Promise<UncoveredObject[]> {
  return prisma.$queryRawUnsafe<UncoveredObject[]>(
    `SELECT o.id, o.source_id, o.full_path, o.catalog_name, o.schema_name, o.object_name, o.last_t1_at
     FROM platform_context_objects o
     WHERE o.org_id = $1
       AND o.lifecycle = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM platform_context_semantics s
         WHERE s.subject_kind = 'object'
           AND s.subject_id = o.id
           AND s.org_id = $1
           AND s.status = 'assumed'
       )
     ORDER BY o.full_path ASC`,
    orgId,
  );
}

/**
 * Build the per-object job scope. Prefer the auto-split partition shape
 * (partition_catalog + partition_schema + partition_objects) so the orchestrator
 * scopes the T2 run to this single object via exact catalog/schema/name matching
 * — the same path split children use. Falls back to an includePatterns glob on
 * full_path only when catalog/schema/name aren't all populated.
 */
function buildScope(o: UncoveredObject): Record<string, unknown> {
  if (o.catalog_name && o.schema_name && o.object_name) {
    return {
      partition_catalog: o.catalog_name,
      partition_schema: o.schema_name,
      partition_objects: [o.object_name],
      [BACKFILL_TAG]: true,
    };
  }
  return {
    includePatterns: [o.full_path],
    [BACKFILL_TAG]: true,
  };
}

interface StatusCounts {
  queued: number;
  running: number;
  succeeded: number;
  partial: number;
  failed: number;
}

async function backfillStatusCounts(orgId: string): Promise<StatusCounts> {
  const rows = await prisma.$queryRawUnsafe<Array<{ status: string; count: number }>>(
    `SELECT status, COUNT(*)::int AS count
     FROM platform_context_jobs
     WHERE org_id = $1
       AND job_kind = 't2_semantic'
       AND (scope->>'${BACKFILL_TAG}') = 'true'
     GROUP BY status`,
    orgId,
  );
  const counts: StatusCounts = { queued: 0, running: 0, succeeded: 0, partial: 0, failed: 0 };
  for (const r of rows) {
    if (r.status in counts) counts[r.status as keyof StatusCounts] = r.count;
  }
  return counts;
}

function formatProgress(enqueued: number, c: StatusCounts): string {
  const completed = c.succeeded + c.partial;
  return (
    `enqueued=${enqueued} queued=${c.queued} in-flight=${c.running} ` +
    `completed=${completed} (succeeded=${c.succeeded} partial=${c.partial}) failed=${c.failed}`
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const org = await getDefaultOrg();
  const orgId = process.env.ORG_ID ?? org.id;

  const concurrency = MAX_CONCURRENT_BY_KIND['t2_semantic'] ?? 5;

  console.log(`[backfill-t2] org=${orgId} concurrency=${concurrency}${dryRun ? ' (dry-run)' : ''}`);

  const objects = await findUncoveredObjects(orgId);
  const withoutT1 = objects.filter((o) => o.last_t1_at === null).length;

  console.log(`[backfill-t2] ${objects.length} active object(s) without a T2 semantic card`);
  if (withoutT1 > 0) {
    console.log(
      `[backfill-t2] note: ${withoutT1} of these have no T1 profile (last_t1_at IS NULL); ` +
      `their jobs will run but enrich 0 objects until T1 has run.`,
    );
  }

  if (objects.length === 0) {
    console.log('[backfill-t2] nothing to do — all active objects already have a T2 card.');
    return;
  }

  if (dryRun) {
    console.log('[backfill-t2] dry-run — objects that WOULD be enqueued:');
    for (const o of objects) {
      const t1 = o.last_t1_at ? 'T1✓' : 'T1✗';
      console.log(`  ${t1}  ${o.full_path}`);
    }
    console.log(`[backfill-t2] dry-run complete — ${objects.length} object(s), nothing enqueued.`);
    return;
  }

  // 1. Enqueue one t2_semantic job per uncovered object.
  let enqueued = 0;
  for (const o of objects) {
    await enqueue('t2_semantic', o.source_id, buildScope(o), 'on_demand', orgId);
    enqueued++;
    if (enqueued % 250 === 0) {
      console.log(`[backfill-t2] enqueued ${enqueued}/${objects.length}...`);
    }
  }
  console.log(`[backfill-t2] enqueued ${enqueued} t2_semantic job(s); draining at concurrency ${concurrency}`);

  // 2. Progress reporter — samples backfill job-status counts on an interval.
  const progressTimer = setInterval(() => {
    backfillStatusCounts(orgId)
      .then((c) => console.log(`[backfill-t2] progress: ${formatProgress(enqueued, c)}`))
      .catch((err) => console.error('[backfill-t2] progress sample failed:', err));
  }, PROGRESS_INTERVAL_MS);

  // 3. Drain the queue using `concurrency` copies of the real orchestrator loop.
  //    claimNext() uses SELECT FOR UPDATE SKIP LOCKED, so the workers cooperate
  //    without ever double-claiming a job; each returns when the queue is empty.
  const workers = Array.from({ length: concurrency }, () =>
    runOrchestratorLoop(orgId, { kindFilter: 't2_semantic' }),
  );

  try {
    await Promise.all(workers);
  } finally {
    clearInterval(progressTimer);
  }

  // 4. Final tally.
  const final = await backfillStatusCounts(orgId);
  console.log(`[backfill-t2] done: ${formatProgress(enqueued, final)}`);
  const stillOpen = final.queued + final.running;
  if (stillOpen > 0) {
    console.warn(`[backfill-t2] WARNING: ${stillOpen} job(s) still queued/running after drain — investigate.`);
  }
}

main()
  .catch((e) => {
    console.error('[backfill-t2] fatal:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
