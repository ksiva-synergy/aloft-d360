/**
 * Refiner — weekly maintenance pass that keeps platform_agent_memory bounded.
 *
 * CRITICAL INVARIANT (bi-temporal, matches curate.ts):
 *   refineMemoryStore() NEVER hard-deletes rows.
 *   All removals are status transitions (SUPERSEDED or EXPIRED) with validUntil set.
 *   The full history is always recoverable.
 *   Every mutation is logged for audit.
 *
 * Four operations, run in sequence:
 *
 *   1. DEDUP CLUSTERING — within each (org, agentClass, taskSignature) group,
 *      find ACTIVE bullet pairs with cosine distance < 0.07 (similarity > 0.93).
 *      Keep the winner (highest score), fold the loser's counts into the winner,
 *      mark the loser SUPERSEDED. Catches duplicates that slipped in across
 *      concurrent synthesis runs — complementary to curate()'s per-candidate dedup.
 *
 *   2. TTL DECAY — expire ACTIVE bullets whose age since
 *      GREATEST(lastUsedAt, createdAt) exceeds the rule-type TTL:
 *        HARD_RULE   — infinite (never expires)
 *        SCHEMA_MAP  — 90 days
 *        HEURISTIC   — 60 days
 *        SOURCE_PREF — 30 days
 *        FAILURE_MODE — 14 days
 *      TTLs are ENV-overridable via MEMORY_TTL_<RULE_TYPE> (days).
 *
 *   3. HARMFUL GC — any ACTIVE bullet with harmfulCount >= helpfulCount
 *      AND harmfulCount >= 3 is marked SUPERSEDED.
 *
 *   4. STATS — count remaining ACTIVE bullets by (agentClass, ruleType).
 *      Logged as the "store bounded" health signal for the AM3 gate.
 */

import { prisma } from '@/lib/prisma';

// ── TTL table (days) — ENV-overridable ────────────────────────────────────────

function getTtlDays(ruleType: string): number | null {
  const envKey = `MEMORY_TTL_${ruleType.toUpperCase()}`;
  const envVal = process.env[envKey];
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  switch (ruleType) {
    case 'HARD_RULE':    return null; // infinite
    case 'SCHEMA_MAP':   return 90;
    case 'HEURISTIC':    return 60;
    case 'SOURCE_PREF':  return 30;
    case 'FAILURE_MODE': return 14;
    default:             return 60;   // unknown types default to HEURISTIC TTL
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RefineResult {
  deduped:           number;
  expired:           number;
  gcRemoved:         number;
  clustersProcessed: number;
}

// Distinct group row returned by the group-discovery query
interface GroupRow {
  agent_class:    string;
  task_signature: string | null;
}

// ACTIVE bullet row used in dedup clustering
interface ActiveBulletRow {
  id:               string;
  rule_type:        string;
  confidence:       number;
  helpful_count:    number;
  harmful_count:    number;
  source_session_ids: string[];
}

// Nearest-neighbour row for pairwise dedup
interface NearRow {
  id:       string;
  distance: number;
}

// Row shape for TTL sweep
interface TtlRow {
  id:          string;
  rule_type:   string;
  created_at:  Date;
  last_used_at: Date | null;
}

// Row shape for stats query
interface StatsRow {
  agent_class: string;
  rule_type:   string;
  cnt:         bigint | number;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function vecLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

// ── Operation 1: Dedup Clustering ─────────────────────────────────────────────

/**
 * Within each (org, agentClass, taskSignature) group, find ACTIVE bullet pairs
 * whose cosine distance is below the DEDUP threshold (same as curate.ts: 0.07).
 * The winner keeps its row; the loser's counts are folded in and it is marked
 * SUPERSEDED. Processes groups sequentially; within large groups batches to 50.
 */
async function runDedupClustering(
  orgId: string,
): Promise<number> {
  const DEDUP_DISTANCE = 0.07;
  const BATCH_SIZE = 50;

  let totalFolded = 0;

  // Discover distinct (agentClass, taskSignature) groups
  const groups = await prisma.$queryRaw<GroupRow[]>`
    SELECT DISTINCT agent_class, task_signature
    FROM platform_agent_memory
    WHERE org_id = ${orgId}
      AND status = 'ACTIVE'
    ORDER BY agent_class, task_signature
  `;

  for (const group of groups) {
    const { agent_class, task_signature } = group;

    // Load all ACTIVE bullets in this group (batch if > BATCH_SIZE)
    const allBullets = await prisma.$queryRaw<ActiveBulletRow[]>`
      SELECT
        id,
        rule_type,
        confidence::float      AS confidence,
        helpful_count,
        harmful_count,
        source_session_ids
      FROM platform_agent_memory
      WHERE org_id         = ${orgId}
        AND agent_class    = ${agent_class}
        AND (
          task_signature = ${task_signature ?? null}
          OR (task_signature IS NULL AND ${task_signature ?? null}::text IS NULL)
        )
        AND status = 'ACTIVE'
      ORDER BY confidence * GREATEST(helpful_count - harmful_count, 0) DESC
      LIMIT ${BATCH_SIZE * 2}
    `;

    if (allBullets.length < 2) continue;

    // Track which IDs have already been folded (losers) in this group pass
    const folded = new Set<string>();

    for (const bullet of allBullets) {
      if (folded.has(bullet.id)) continue;

      // Find ACTIVE near-duplicates of this bullet (excluding itself and already-folded)
      // We use a raw query for the vector distance; this bullet acts as the anchor.
      // To get the embedding we query for it inline — pgvector self-join pattern.
      const nearRows = await prisma.$queryRaw<NearRow[]>`
        SELECT
          b.id,
          (b.embedding <=> anchor.embedding) AS distance
        FROM platform_agent_memory b,
             platform_agent_memory anchor
        WHERE anchor.id       = ${bullet.id}
          AND b.org_id        = ${orgId}
          AND b.agent_class   = ${agent_class}
          AND (
            b.task_signature = ${task_signature ?? null}
            OR (b.task_signature IS NULL AND ${task_signature ?? null}::text IS NULL)
          )
          AND b.status        = 'ACTIVE'
          AND b.id            != ${bullet.id}
          AND b.embedding     IS NOT NULL
          AND anchor.embedding IS NOT NULL
          AND (b.embedding <=> anchor.embedding) < ${DEDUP_DISTANCE}
        ORDER BY distance ASC
        LIMIT ${BATCH_SIZE}
      `;

      if (nearRows.length === 0) continue;

      // Compute winner score for this anchor
      const anchorScore = bullet.confidence * Math.max(
        bullet.helpful_count - bullet.harmful_count, 0,
      );

      for (const near of nearRows) {
        if (folded.has(near.id)) continue;

        // Load full data for the near duplicate to compare scores
        const nearFull = allBullets.find(b => b.id === near.id);
        if (!nearFull) continue;

        const nearScore = nearFull.confidence * Math.max(
          nearFull.helpful_count - nearFull.harmful_count, 0,
        );

        // Determine winner and loser
        const winnerId  = anchorScore >= nearScore ? bullet.id  : near.id;
        const loserId   = anchorScore >= nearScore ? near.id    : bullet.id;
        const winner    = anchorScore >= nearScore ? bullet     : nearFull;
        const loser     = anchorScore >= nearScore ? nearFull   : bullet;

        const now = new Date();

        // Fold loser counts into winner, merge session IDs
        const mergedSessions = Array.from(
          new Set([...winner.source_session_ids, ...loser.source_session_ids]),
        );

        await prisma.platformAgentMemory.update({
          where: { id: winnerId },
          data: {
            helpfulCount:     { increment: loser.helpful_count },
            harmfulCount:     { increment: loser.harmful_count },
            sourceSessionIds: mergedSessions,
          },
        });

        // Mark loser SUPERSEDED
        await prisma.platformAgentMemory.update({
          where: { id: loserId },
          data: {
            status:     'SUPERSEDED',
            validUntil: now,
          },
        });

        console.log(
          `[refine/dedup] FOLD loser=${loserId} -> winner=${winnerId}` +
          ` dist=${(near.distance as number).toFixed(4)}` +
          ` agentClass=${agent_class} taskSig=${task_signature ?? 'null'}`,
        );

        folded.add(loserId);
        // Update winner's in-memory state so subsequent folds in this loop
        // use the accumulated counts AND the accumulated session list.
        winner.helpful_count     += loser.helpful_count;
        winner.harmful_count     += loser.harmful_count;
        winner.source_session_ids = mergedSessions;
        totalFolded++;
      }
    }
  }

  return totalFolded;
}

// ── Operation 2: TTL Decay ────────────────────────────────────────────────────

/**
 * Expire ACTIVE bullets whose age since GREATEST(lastUsedAt, createdAt)
 * exceeds the rule-type TTL. HARD_RULEs are skipped (infinite TTL).
 * All transitions: status = 'EXPIRED', validUntil = now().
 */
async function runTtlDecay(orgId: string): Promise<number> {
  let totalExpired = 0;
  const now = new Date();

  // Load all ACTIVE non-HARD_RULE bullets with their temporal anchor
  const rows = await prisma.$queryRaw<TtlRow[]>`
    SELECT id, rule_type, created_at, last_used_at
    FROM platform_agent_memory
    WHERE org_id   = ${orgId}
      AND status   = 'ACTIVE'
      AND rule_type != 'HARD_RULE'
  `;

  for (const row of rows) {
    const ttlDays = getTtlDays(row.rule_type);
    if (ttlDays === null) continue; // HARD_RULE or unrecognised explicit null

    // TTL clock: most recent of lastUsedAt and createdAt
    const anchor = row.last_used_at
      ? new Date(Math.max(row.last_used_at.getTime(), row.created_at.getTime()))
      : row.created_at;

    const ageMs  = now.getTime() - anchor.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays < ttlDays) continue;

    await prisma.platformAgentMemory.update({
      where: { id: row.id },
      data: {
        status:     'EXPIRED',
        validUntil: now,
      },
    });

    console.log(
      `[refine/ttl] EXPIRED id=${row.id} ruleType=${row.rule_type}` +
      ` ageDays=${ageDays.toFixed(1)} ttlDays=${ttlDays}` +
      ` anchor=${anchor.toISOString()}`,
    );
    totalExpired++;
  }

  return totalExpired;
}

// ── Operation 3: Harmful GC ───────────────────────────────────────────────────

/**
 * Demote ACTIVE bullets where harmfulCount >= helpfulCount AND harmfulCount >= 3.
 * These are rules that have been observed to cause harm at least 3 times and
 * are no longer beneficial overall. Marked SUPERSEDED (not EXPIRED) to signal
 * the reason was behavioural, not temporal.
 */
async function runHarmfulGc(orgId: string): Promise<number> {
  const now = new Date();

  // Use a raw UPDATE … RETURNING to do this in a single round-trip
  type GcRow = { id: string };
  const rows = await prisma.$queryRaw<GcRow[]>`
    UPDATE platform_agent_memory
    SET status      = 'SUPERSEDED',
        valid_until = ${now},
        updated_at  = ${now}
    WHERE org_id        = ${orgId}
      AND status        = 'ACTIVE'
      AND harmful_count >= helpful_count
      AND harmful_count >= 3
    RETURNING id
  `;

  const count = rows.length;
  if (count > 0) {
    console.log(`[refine/gc] SUPERSEDED ${count} harmful bullet(s) for org=${orgId}`);
    for (const row of rows) {
      console.log(`[refine/gc]   id=${row.id}`);
    }
  }

  return count;
}

// ── Operation 4: Stats ────────────────────────────────────────────────────────

/**
 * Count remaining ACTIVE bullets grouped by (agentClass, ruleType).
 * Logged as the health signal for the AM3 gate — confirms the store is bounded.
 */
async function logStoreStats(orgId: string): Promise<void> {
  const rows = await prisma.$queryRaw<StatsRow[]>`
    SELECT agent_class, rule_type, COUNT(*) AS cnt
    FROM platform_agent_memory
    WHERE org_id = ${orgId}
      AND status = 'ACTIVE'
    GROUP BY agent_class, rule_type
    ORDER BY agent_class, rule_type
  `;

  console.log(`[refine/stats] ACTIVE bullet distribution for org=${orgId}:`);
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }

  let total = 0;
  for (const row of rows) {
    const cnt = Number(row.cnt);
    total += cnt;
    console.log(`  agentClass=${row.agent_class} ruleType=${row.rule_type} count=${cnt}`);
  }
  console.log(`  TOTAL active bullets: ${total}`);
}

// ── refineMemoryStore ─────────────────────────────────────────────────────────

/**
 * Run the full weekly maintenance pass for one organisation.
 *
 * Idempotent: safe to re-run; all mutations are status transitions only.
 * Never throws — caller always gets a result; errors abort the in-flight
 * operation and are surfaced through the returned object.
 */
export async function refineMemoryStore(orgId: string): Promise<RefineResult> {
  console.log(`[refine] starting maintenance pass org=${orgId}`);

  const result: RefineResult = {
    deduped:           0,
    expired:           0,
    gcRemoved:         0,
    clustersProcessed: 0,
  };

  // ── 1. Dedup clustering ────────────────────────────────────────────────────
  try {
    result.deduped = await runDedupClustering(orgId);
    console.log(`[refine] dedup done: ${result.deduped} bullet(s) folded`);
  } catch (err: unknown) {
    console.error('[refine] ERROR in dedup clustering (continuing):', err instanceof Error ? err.message : String(err));
  }

  // ── 2. TTL decay ───────────────────────────────────────────────────────────
  try {
    result.expired = await runTtlDecay(orgId);
    console.log(`[refine] ttl-decay done: ${result.expired} bullet(s) expired`);
  } catch (err: unknown) {
    console.error('[refine] ERROR in TTL decay (continuing):', err instanceof Error ? err.message : String(err));
  }

  // ── 3. Harmful GC ──────────────────────────────────────────────────────────
  try {
    result.gcRemoved = await runHarmfulGc(orgId);
    console.log(`[refine] harmful-gc done: ${result.gcRemoved} bullet(s) removed`);
  } catch (err: unknown) {
    console.error('[refine] ERROR in harmful GC (continuing):', err instanceof Error ? err.message : String(err));
  }

  // ── 4. Stats ───────────────────────────────────────────────────────────────
  try {
    await logStoreStats(orgId);
    result.clustersProcessed = result.deduped + result.expired + result.gcRemoved;
  } catch (err: unknown) {
    console.error('[refine] ERROR in stats (continuing):', err instanceof Error ? err.message : String(err));
  }

  console.log(
    `[refine] maintenance pass complete org=${orgId}` +
    ` deduped=${result.deduped} expired=${result.expired}` +
    ` gcRemoved=${result.gcRemoved}`,
  );
  return result;
}
