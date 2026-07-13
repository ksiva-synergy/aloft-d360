/**
 * reputation-season-rollover.ts — weekly season rollover entrypoint.
 *
 * Wire this into the existing weekly Sunday 05:30 UTC scheduler:
 *   AWS EventBridge:  cron(30 5 ? * SUN *)
 *
 * It advances every active reputation domain for the default org to the current
 * season (see src/lib/memory/reputation/season.ts) — snapshotting each user's
 * rank into last_rank so next season shows movement arrows, then zeroing
 * season_xp. Safe to run more than once in the same week: the target season id
 * is calendar-derived, so a second run finds every domain already current and
 * does nothing (see runSeasonRollover's idempotency guard).
 *
 * Usage (from repo root, with env loaded):
 *   MEMORY_REPUTATION_ENABLED=true npx tsx scripts/reputation-season-rollover.ts
 */

import { getDefaultOrg } from '@/lib/platform/agents';
import { runSeasonRollover } from '@/lib/memory/reputation/rollover';
import { prisma } from '@/lib/prisma';

async function main() {
  if (process.env.MEMORY_REPUTATION_ENABLED !== 'true') {
    console.log('[season-rollover] MEMORY_REPUTATION_ENABLED != "true" — skipping.');
    return;
  }

  const org = await getDefaultOrg();
  const summary = await runSeasonRollover(org.id);

  console.log(
    `[season-rollover] org=${org.id} season=${summary.seasonId} ` +
      `rolled=[${summary.domainsRolled.join(', ')}] ` +
      `skipped=[${summary.domainsSkipped.join(', ')}]`,
  );
}

main()
  .catch((e) => {
    console.error('[season-rollover] failed', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
