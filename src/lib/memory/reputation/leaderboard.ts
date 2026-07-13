/**
 * leaderboard.ts — per-domain, cohort-scoped, seasonal leaderboard.
 *
 * Design choices come straight from the research:
 *   - Ranking is per DOMAIN (agent_class), not one global board.
 *   - Users are bucketed into leagues of ~cohortSize (Duolingo ≈ 30) so the
 *     people you're compared against feel reachable.
 *   - We return the top-N of the user's league + a window around the user.
 *     We never expose a global "bottom of the pile" list (demotivating).
 *   - Promotion (top third) / demotion (bottom fifth) zones create the
 *     loss-aversion pull that drives re-engagement.
 *   - season_xp resets each season; last_rank enables movement arrows.
 */

import { prisma } from '@/lib/prisma';
import { streetCred, DEFAULT_CONFIG, EngineConfig, DomainReputation } from './engine';

export interface LeaderboardEntry {
  userId: string;
  rank: number; // 1-based within the league
  seasonXp: number;
  cred: number; // durable street-cred score (0–100)
  provisional: boolean;
  zone: 'promotion' | 'demotion' | 'hold';
  movement: number | null; // last_rank - rank (positive = climbed); null if new
  isYou: boolean;
}

export interface LeaderboardView {
  domain: string;
  league: number; // 0-based league index (0 = top league)
  leagueSize: number;
  top: LeaderboardEntry[]; // top-N of the league
  around: LeaderboardEntry[]; // window centred on the requesting user
  you: LeaderboardEntry | null;
}

interface BoardRow {
  user_id: string;
  season_xp: number;
  pos: number;
  neg: number;
  role: string;
  last_decay_at: Date;
  cap_day: Date;
  cap_pos_today: number;
  season_id: string;
  last_rank: number | null;
}

export async function getLeaderboard(
  orgId: string,
  domain: string,
  requestingUserId: string | null,
  opts: { topN?: number; cohortSize?: number; window?: number; cfg?: EngineConfig } = {},
): Promise<LeaderboardView> {
  const topN = opts.topN ?? 10;
  const cohortSize = opts.cohortSize ?? 30;
  const window = opts.window ?? 2;
  const cfg = opts.cfg ?? DEFAULT_CONFIG;

  const rows = await prisma.$queryRaw<BoardRow[]>`
    SELECT user_id, season_xp, pos, neg, role, last_decay_at, cap_day, cap_pos_today, season_id, last_rank
    FROM platform_user_reputation
    WHERE org_id = ${orgId} AND domain = ${domain}
    ORDER BY season_xp DESC, updated_at ASC
  `;

  // Bucket into leagues; locate the requesting user's league (default top).
  const youIndex = requestingUserId ? rows.findIndex((r) => r.user_id === requestingUserId) : -1;
  const league = youIndex >= 0 ? Math.floor(youIndex / cohortSize) : 0;
  const start = league * cohortSize;
  const leagueRows = rows.slice(start, start + cohortSize);
  const leagueSize = leagueRows.length;

  const promotionCut = Math.ceil(leagueSize / 3); // top third promote
  const demotionCut = leagueSize - Math.floor(leagueSize / 5); // bottom fifth demote (0-based threshold)

  const toEntry = (r: BoardRow, idxInLeague: number): LeaderboardEntry => {
    const rank = idxInLeague + 1;
    const state = rowToState(r);
    const sc = streetCred(state, cfg);
    let zone: LeaderboardEntry['zone'] = 'hold';
    if (idxInLeague < promotionCut) zone = 'promotion';
    else if (idxInLeague >= demotionCut) zone = 'demotion';
    return {
      userId: r.user_id,
      rank,
      seasonXp: Number(r.season_xp),
      cred: sc.score,
      provisional: sc.provisional,
      zone,
      movement: r.last_rank == null ? null : r.last_rank - rank,
      isYou: r.user_id === requestingUserId,
    };
  };

  const entries = leagueRows.map(toEntry);
  const top = entries.slice(0, topN);

  let you: LeaderboardEntry | null = null;
  let around: LeaderboardEntry[] = [];
  if (youIndex >= 0) {
    const localIdx = youIndex - start;
    you = entries[localIdx] ?? null;
    const lo = Math.max(0, localIdx - window);
    const hi = Math.min(entries.length, localIdx + window + 1);
    around = entries.slice(lo, hi);
  }

  return { domain, league, leagueSize, top, around, you };
}

/**
 * Season rollover for one org+domain: snapshot each user's current rank into
 * last_rank (for movement arrows), then zero season_xp. Run from the weekly job.
 */
export async function rolloverSeason(
  orgId: string,
  domain: string,
  newSeasonId: string,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id FROM platform_user_reputation
    WHERE org_id = ${orgId} AND domain = ${domain}
    ORDER BY season_xp DESC, updated_at ASC
  `;
  // Persist ranks, then reset. Small N per (org, domain); a loop is fine.
  for (let i = 0; i < rows.length; i++) {
    await prisma.$executeRaw`
      UPDATE platform_user_reputation
      SET last_rank = ${i + 1}, season_xp = 0, season_id = ${newSeasonId}, updated_at = now()
      WHERE org_id = ${orgId} AND user_id = ${rows[i].user_id} AND domain = ${domain}
    `;
  }
}

function rowToState(r: BoardRow): DomainReputation {
  return {
    userId: r.user_id,
    domain: '',
    role: r.role,
    pos: Number(r.pos),
    neg: Number(r.neg),
    lastDecayAt: new Date(r.last_decay_at).getTime(),
    capDay: new Date(r.cap_day).toISOString().slice(0, 10),
    capPosToday: Number(r.cap_pos_today),
    seasonXp: Number(r.season_xp),
  };
}
