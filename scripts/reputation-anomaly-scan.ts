/**
 * reputation-anomaly-scan.ts — Phase D3: read-only gaming / anomaly monitor.
 *
 * ADDITIVE and READ-ONLY. It never writes, never enforces — it only surfaces
 * visibility so a human can decide whether the cred signal is being gamed before
 * it is ever weighted (Phase C). Fold it into the existing weekly Sunday
 * 05:30 UTC scheduler alongside reputation-season-rollover.ts, or run it on a
 * lighter daily cron:
 *   AWS EventBridge:  cron(30 5 ? * SUN *)   (or cron(0 6 * * ? *) daily)
 *
 * Three signals (see Phase D brief):
 *   1. Cred spikes            — a user accruing an unusually large burst of
 *                               positive contributions in a short window.
 *   2. Collusive reinforcement — pairs who repeatedly validate EACH OTHER's
 *                               bullets (mutual back-scratching).
 *   3. Daily-cap saturation    — users pinned at the 20/day positive cap.
 *
 * Usage (from repo root, with env loaded):
 *   MEMORY_REPUTATION_ENABLED=true npx tsx scripts/reputation-anomaly-scan.ts
 */

import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CONFIG } from '@/lib/memory/reputation/engine';

// ── Tunables ────────────────────────────────────────────────────────────────
const SPIKE_WINDOW_HOURS = 24; // window over which a burst of contributions is a "spike"
const SPIKE_MIN_COUNT = 15; // hard floor: never flag below this many events in-window
const SPIKE_SIGMA = 3; // also flag anyone above mean + 3σ of the in-window population
const COLLUSION_WINDOW_DAYS = 30;
const COLLUSION_MIN_PAIR = 3; // each direction must recur at least this many times
const DAILY_CAP = DEFAULT_CONFIG.dailyPositiveCap; // 20
const SATURATION_FRACTION = 0.95; // "at the cap" == within 5% of the daily cap

interface SpikeRow { user_id: string; domain: string; n: number }
interface CollusionRow { user_a: string; user_b: string; a_validates_b: number; b_validates_a: number }
interface SaturationRow { user_id: string; domain: string; cap_pos_today: number }

/** 1. Cred spikes — burst of contributions per (user,domain) inside the window. */
async function scanCredSpikes(orgId: string): Promise<SpikeRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ user_id: string; domain: string; n: bigint }>>(
    `
    SELECT user_id, domain, count(*)::bigint AS n
    FROM platform_memory_contributions
    WHERE org_id = $1
      AND created_at > now() - ($2 || ' hours')::interval
    GROUP BY user_id, domain
    `,
    orgId,
    String(SPIKE_WINDOW_HOURS),
  );
  const counts = rows.map((r) => Number(r.n));
  if (counts.length === 0) return [];
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  const std = Math.sqrt(variance);
  const threshold = Math.max(SPIKE_MIN_COUNT, mean + SPIKE_SIGMA * std);
  return rows
    .map((r) => ({ user_id: r.user_id, domain: r.domain, n: Number(r.n) }))
    .filter((r) => r.n >= threshold)
    .sort((a, b) => b.n - a.n);
}

/** 2. Collusive reinforcement — mutual validation pairs above threshold. */
async function scanCollusion(orgId: string): Promise<CollusionRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    user_a: string; user_b: string; a_validates_b: bigint; b_validates_a: bigint;
  }>>(
    `
    WITH val AS (
      SELECT i.contributor_user_id AS validator, c.user_id AS author, count(*)::bigint AS n
      FROM platform_memory_injections i
      JOIN platform_memory_contributions c
        ON c.memory_id = i.bullet_id AND c.contribution_type = 'INSERT_AUTHOR'
      WHERE i.org_id = $1
        AND i.attributed_at IS NOT NULL
        AND i.attributed_at > now() - ($2 || ' days')::interval
        AND i.contributor_user_id IS NOT NULL
        AND i.contributor_user_id <> c.user_id
      GROUP BY i.contributor_user_id, c.user_id
    )
    SELECT a.validator AS user_a, a.author AS user_b,
           a.n AS a_validates_b, b.n AS b_validates_a
    FROM val a
    JOIN val b ON a.validator = b.author AND a.author = b.validator
    WHERE a.validator < a.author           -- one row per unordered pair
      AND a.n >= $3 AND b.n >= $3
    ORDER BY (a.n + b.n) DESC
    `,
    orgId,
    String(COLLUSION_WINDOW_DAYS),
    COLLUSION_MIN_PAIR,
  );
  return rows.map((r) => ({
    user_a: r.user_a,
    user_b: r.user_b,
    a_validates_b: Number(r.a_validates_b),
    b_validates_a: Number(r.b_validates_a),
  }));
}

/** 3. Daily-cap saturation — users pinned at (or within 5% of) the positive cap today. */
async function scanCapSaturation(orgId: string): Promise<SaturationRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ user_id: string; domain: string; cap_pos_today: number }>>(
    `
    SELECT user_id, domain, cap_pos_today
    FROM platform_user_reputation
    WHERE org_id = $1
      AND cap_day = CURRENT_DATE
      AND cap_pos_today >= $2
    ORDER BY cap_pos_today DESC
    `,
    orgId,
    DAILY_CAP * SATURATION_FRACTION,
  );
  return rows.map((r) => ({ user_id: r.user_id, domain: r.domain, cap_pos_today: Number(r.cap_pos_today) }));
}

async function main() {
  if (process.env.MEMORY_REPUTATION_ENABLED !== 'true') {
    console.log('[anomaly-scan] MEMORY_REPUTATION_ENABLED != "true" — skipping.');
    return;
  }

  const org = await getDefaultOrg();

  const [spikes, collusion, saturation] = await Promise.all([
    scanCredSpikes(org.id),
    scanCollusion(org.id),
    scanCapSaturation(org.id),
  ]);

  console.log(
    `[anomaly-scan] org=${org.id} ` +
      `spikes=${spikes.length} collusion_pairs=${collusion.length} cap_saturated=${saturation.length}`,
  );

  for (const s of spikes) {
    console.warn(
      `[anomaly-scan][spike] user=${s.user_id} domain=${s.domain} ` +
        `contributions_in_${SPIKE_WINDOW_HOURS}h=${s.n}`,
    );
  }
  for (const c of collusion) {
    console.warn(
      `[anomaly-scan][collusion] pair=${c.user_a}<->${c.user_b} ` +
        `a_validates_b=${c.a_validates_b} b_validates_a=${c.b_validates_a} ` +
        `window=${COLLUSION_WINDOW_DAYS}d`,
    );
  }
  for (const s of saturation) {
    console.warn(
      `[anomaly-scan][cap-saturation] user=${s.user_id} domain=${s.domain} ` +
        `cap_pos_today=${s.cap_pos_today}/${DAILY_CAP}`,
    );
  }

  // NOTE: visibility only — no enforcement in Phase D. Swap console.warn for your
  // alerting sink (e.g. a webhook) when wiring this into the scheduler.
}

main()
  .catch((e) => {
    console.error('[anomaly-scan] failed', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
