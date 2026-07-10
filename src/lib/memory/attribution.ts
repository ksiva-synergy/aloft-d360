/**
 * attribution.ts — M3: Close the helpful/harmful attribution loop.
 *
 * Two entry points:
 *   recordInjection()       — called at injection time to persist the post-MMR set.
 *   attributeRunOutcome()   — called after run completion to update counters.
 *
 * Idempotency is enforced at the DB level:
 *   - UNIQUE(run_id, bullet_id) prevents double-insert from replayed invocations.
 *   - attributed_at marker prevents double-counting on replayed outcome calls.
 */

import { prisma } from '@/lib/prisma';

// ── recordInjection ──────────────────────────────────────────────────────────

export interface InjectedBullet {
  bulletId: string;
  phase:    string;   // 'INIT' | 'SCHEMA_GLOBAL' | 'TASK_SCOPED'
}

/**
 * Persist the set of memory bullets actually injected into a run.
 * Called once per run at injection time (post-MMR, post-budget-packing).
 *
 * Uses ON CONFLICT DO NOTHING — safe to call multiple times for the same run.
 */
export async function recordInjection(
  orgId:    string,
  runId:    string,
  injected: InjectedBullet[],
): Promise<void> {
  if (injected.length === 0) return;

  // Filter out the synthetic default guardrail (not a real DB bullet)
  const real = injected.filter((b) => !b.bulletId.startsWith('__'));
  if (real.length === 0) return;

  // Insert each row individually with parameterized query for safety.
  // ON CONFLICT DO NOTHING makes this idempotent.
  await Promise.all(
    real.map((b) =>
      prisma.$executeRawUnsafe(`
        INSERT INTO platform_memory_injections (id, org_id, run_id, bullet_id, phase, created_at)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())
        ON CONFLICT (run_id, bullet_id) DO NOTHING
      `, orgId, runId, b.bulletId, b.phase),
    ),
  );
}

// ── attributeRunOutcome ──────────────────────────────────────────────────────

const CONFIDENCE_NUDGE     = 0.02;
const CONFIDENCE_MAX       = 1.0;
const HARMFUL_SUPERSEDE_THRESHOLD = 3;

/**
 * Attribute a run outcome to all bullets injected in that run.
 *
 * Idempotency: only processes rows where attributed_at IS NULL.
 * A replayed call for the same runId finds zero unattributed rows → no-op.
 *
 * On success: helpful_count++, confidence += 0.02 (clamped to 1.0), last_used_at = NOW().
 * On failure: harmful_count++.
 * Conflict-GC: any bullet where harmful_count >= helpful_count AND harmful_count >= 3
 *   gets status = 'SUPERSEDED'.
 */
export async function attributeRunOutcome(
  runId:   string,
  outcome: { success: boolean },
): Promise<{ attributed: number; superseded: number }> {
  // 1. Claim unattributed injection rows for this run (atomic mark)
  const claimed = await prisma.$queryRawUnsafe<Array<{ bullet_id: string }>>(`
    UPDATE platform_memory_injections
    SET attributed_at = NOW()
    WHERE run_id = $1 AND attributed_at IS NULL
    RETURNING bullet_id
  `, runId);

  if (claimed.length === 0) {
    return { attributed: 0, superseded: 0 };
  }

  const bulletIds = claimed.map((r) => r.bullet_id);

  // 2. Update counters on the memory bullets
  if (outcome.success) {
    await prisma.$executeRawUnsafe(`
      UPDATE platform_agent_memory
      SET
        helpful_count = helpful_count + 1,
        confidence = LEAST(confidence + $2, $3),
        last_used_at = NOW(),
        updated_at = NOW()
      WHERE id = ANY($1::text[])
        AND status = 'ACTIVE'
    `, bulletIds, CONFIDENCE_NUDGE, CONFIDENCE_MAX);
  } else {
    await prisma.$executeRawUnsafe(`
      UPDATE platform_agent_memory
      SET
        harmful_count = harmful_count + 1,
        updated_at = NOW()
      WHERE id = ANY($1::text[])
        AND status = 'ACTIVE'
    `, bulletIds);
  }

  // 3. Conflict-GC: supersede bullets that have accumulated enough harm
  const superseded = await prisma.$executeRawUnsafe<number>(`
    UPDATE platform_agent_memory
    SET
      status = 'SUPERSEDED',
      valid_until = NOW(),
      updated_at = NOW()
    WHERE id = ANY($1::text[])
      AND status = 'ACTIVE'
      AND harmful_count >= helpful_count
      AND harmful_count >= $2
  `, bulletIds, HARMFUL_SUPERSEDE_THRESHOLD);

  return { attributed: claimed.length, superseded: Number(superseded) };
}
