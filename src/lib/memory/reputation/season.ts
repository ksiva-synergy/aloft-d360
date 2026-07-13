/**
 * season.ts — season identity for the reputation leaderboard.
 *
 * A "season" is a weekly window that resets every Sunday 05:30 UTC via the
 * rollover job (see rollover.ts). The season id is DERIVED DETERMINISTICALLY
 * from the calendar rather than stored as mutable state, which is what makes the
 * weekly job idempotent: two runs in the same week compute the SAME id, so the
 * rollover guard can skip a domain that has already been advanced to it.
 *
 * Ids read like S1, S2, S3… — S1 is the launch week (the week containing the
 * REPUTATION_SEASON_EPOCH). The automatic "bump S1→S2" the brief describes is
 * simply the week counter ticking over.
 *
 * `REPUTATION_SEASON`, if set, is a HARD OVERRIDE: it pins the season id and
 * disables calendar derivation. This preserves the Phase-A default exactly
 * (Phase A read `process.env.REPUTATION_SEASON ?? 'S1'`), and gives ops a manual
 * escape hatch — but note that while it is set the weekly rollover cannot
 * advance the season, because every week resolves to the same pinned id.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Default epoch: the Sunday on/before the Phase B launch. Season 1 begins here. */
const DEFAULT_EPOCH = '2026-07-12'; // Sunday preceding 2026-07-13 launch

/** Parse a YYYY-MM-DD string as UTC midnight (ms). */
function parseUtcMidnight(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Epoch (ms) for season 1, snapped back to the UTC Sunday on/before the
 * configured date so week boundaries line up with the Sunday job regardless of
 * which weekday the configured epoch happens to land on.
 */
function seasonEpochMs(): number {
  const raw = process.env.REPUTATION_SEASON_EPOCH ?? DEFAULT_EPOCH;
  const t = parseUtcMidnight(raw);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return t - dow * MS_PER_DAY;
}

/**
 * The season id that should be current at `now`.
 *   - `REPUTATION_SEASON` set  → that literal id (pins the season; see file docs).
 *   - otherwise                → `S{n}` where n counts weeks since the epoch,
 *                                clamped so anything at/before the epoch is S1.
 */
export function currentSeasonId(now: number = Date.now()): string {
  const override = process.env.REPUTATION_SEASON;
  if (override) return override;
  const weeks = Math.floor((now - seasonEpochMs()) / MS_PER_WEEK);
  return `S${Math.max(1, weeks + 1)}`;
}
