/**
 * rollover.ts — the weekly season rollover, wired to run from the Sunday
 * 05:30 UTC job (see scripts/reputation-season-rollover.ts).
 *
 * For each active domain it calls leaderboard.ts::rolloverSeason(), which
 * snapshots each user's current rank into last_rank (for next season's movement
 * arrows) and zeroes season_xp.
 *
 * IDEMPOTENT: the target season id is derived from the calendar (season.ts), and
 * a domain is rolled only if at least one of its rows is still behind that id. A
 * second run in the same week therefore finds every row already at the target
 * and is a guaranteed no-op — no double reset, no clobbered movement.
 */

import { prisma } from '@/lib/prisma';
import { rolloverSeason } from './leaderboard';
import { currentSeasonId } from './season';

export interface RolloverSummary {
  seasonId: string;
  domainsRolled: string[];
  domainsSkipped: string[];
}

/** Distinct reputation domains for an org — the ones that actually carry seasons. */
async function activeDomains(orgId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ domain: string }>>`
    SELECT DISTINCT domain FROM platform_user_reputation WHERE org_id = ${orgId}
    ORDER BY domain ASC
  `;
  return rows.map((r) => r.domain);
}

/** Count rows in a domain that have NOT yet been advanced to `seasonId`. */
async function rowsBehind(orgId: string, domain: string, seasonId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM platform_user_reputation
    WHERE org_id = ${orgId} AND domain = ${domain} AND season_id <> ${seasonId}
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Advance every active domain for an org to the current season, idempotently.
 * Returns which domains were rolled vs. skipped (already current).
 */
export async function runSeasonRollover(
  orgId: string,
  now: number = Date.now(),
): Promise<RolloverSummary> {
  const seasonId = currentSeasonId(now);
  const domains = await activeDomains(orgId);
  const domainsRolled: string[] = [];
  const domainsSkipped: string[] = [];

  for (const domain of domains) {
    if ((await rowsBehind(orgId, domain, seasonId)) === 0) {
      domainsSkipped.push(domain); // already rolled this week — skip
      continue;
    }
    await rolloverSeason(orgId, domain, seasonId);
    domainsRolled.push(domain);
  }

  return { seasonId, domainsRolled, domainsSkipped };
}
