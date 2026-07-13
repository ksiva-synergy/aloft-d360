/**
 * store.ts — Prisma-backed persistence + integration hooks for the reputation
 * engine. Uses raw SQL for the new tables so it works immediately after
 * migration.sql, with no `prisma generate` required. Swap to typed Prisma calls
 * later if you add the models from schema-additions.prisma.
 *
 * Wiring summary (see README.md for the exact patch points):
 *   - curate.ts        -> recordContribution(...) on INSERT / DEDUP / SUPERSEDE
 *   - attribution.ts   -> attributeOutcomeForRun(...) on run completion
 *   - retrieve.ts      -> reputation multiplier is already denormalised onto
 *                         platform_agent_memory.contributor_rep; just multiply it
 *                         into the score (Stage 3, gated by a flag).
 */

import { prisma } from '@/lib/prisma'; // adjust to your Prisma client import
import {
  DomainReputation,
  EngineConfig,
  DEFAULT_CONFIG,
  DEFAULT_ROLE,
  OutcomeType,
  newDomainReputation,
  applyOutcome,
  reputationMean,
  evidenceCount,
  aggregateContributorReputation,
  repMultiplier,
} from './engine';
import { currentSeasonId } from './season';

// ---------------------------------------------------------------------------
// Identity / role resolution
// ---------------------------------------------------------------------------

/** Resolve the acting user for a workbench (inspector) session. */
export async function resolveContributorUserId(sessionId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ user_id: string | null }>>`
    SELECT user_id FROM workbench_sessions WHERE id = ${sessionId}::uuid LIMIT 1
  `;
  const uid = rows[0]?.user_id ?? null;
  return uid && uid !== 'anonymous' ? uid : null;
}

/**
 * Map an RBAC role name (src/lib/rbac.ts) to a ROLE_PRIORS key (engine.ts).
 * RBAC roles are platform_admin | admin | member | readonly; engine priors are
 * founder | senior | member | contributor | external | new. Anything not listed
 * here falls through to DEFAULT_ROLE ('member').
 */
const RBAC_ROLE_TO_PRIOR: Record<string, string> = {
  platform_admin: 'founder',
  admin: 'senior',
  member: 'member',
  readonly: 'external',
};

/** Highest-privilege first — pick the coarse primary role when a user has several. */
const ROLE_PRECEDENCE = ['platform_admin', 'admin', 'member', 'readonly'];

/**
 * Resolve a user's role prior from the RBAC role assignment (D2). Reads the real
 * role source (user_roles → roles) so we do NOT maintain a parallel role system;
 * the resolved RBAC role is mapped onto an engine ROLE_PRIORS key.
 *
 * Fully defensive: if the RBAC tables are absent (e.g. the reputation code is
 * deployed without the RBAC migration), the user has no role rows, or the role
 * is unmapped, we fall back to DEFAULT_ROLE ('member'). Role resolution must
 * never break attribution.
 *
 * NOTE: because this changes cold-start priors, existing users' cred will shift
 * slightly (a platform_admin now starts at the 'founder' prior instead of
 * 'member'). This is expected — not a leaderboard bug.
 */
export async function resolveRole(userId: string): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ${userId}
    `;
    if (rows.length === 0) return DEFAULT_ROLE;
    const names = rows.map((x) => x.name);
    const primary = ROLE_PRECEDENCE.find((r) => names.includes(r)) ?? names[0];
    return RBAC_ROLE_TO_PRIOR[primary] ?? DEFAULT_ROLE;
  } catch {
    // RBAC tables not present / query error → safe neutral default.
    return DEFAULT_ROLE;
  }
}

// ---------------------------------------------------------------------------
// Reputation row <-> DomainReputation mapping
// ---------------------------------------------------------------------------

interface RepRow {
  user_id: string;
  domain: string;
  role: string;
  pos: number;
  neg: number;
  last_decay_at: Date;
  cap_day: Date;
  cap_pos_today: number;
  season_id: string;
  season_xp: number;
}

function rowToState(r: RepRow): DomainReputation {
  return {
    userId: r.user_id,
    domain: r.domain,
    role: r.role,
    pos: Number(r.pos),
    neg: Number(r.neg),
    lastDecayAt: new Date(r.last_decay_at).getTime(),
    capDay: new Date(r.cap_day).toISOString().slice(0, 10),
    capPosToday: Number(r.cap_pos_today),
    seasonXp: Number(r.season_xp),
  };
}

async function loadOrInit(
  orgId: string,
  userId: string,
  domain: string,
): Promise<DomainReputation> {
  const rows = await prisma.$queryRaw<RepRow[]>`
    SELECT user_id, domain, role, pos, neg, last_decay_at, cap_day, cap_pos_today, season_id, season_xp
    FROM platform_user_reputation
    WHERE org_id = ${orgId} AND user_id = ${userId} AND domain = ${domain}
    LIMIT 1
  `;
  if (rows.length > 0) return rowToState(rows[0]);
  const role = await resolveRole(userId);
  return newDomainReputation(userId, domain, role);
}

async function persist(orgId: string, rep: DomainReputation): Promise<void> {
  // Upsert on (org_id, user_id, domain). Last-write-wins is acceptable for v1;
  // reputation updates are per-user and low-contention.
  await prisma.$executeRaw`
    INSERT INTO platform_user_reputation
      (org_id, user_id, domain, role, pos, neg, last_decay_at, cap_day, cap_pos_today, season_id, season_xp, updated_at)
    VALUES
      (${orgId}, ${rep.userId}, ${rep.domain}, ${rep.role}, ${rep.pos}, ${rep.neg},
       to_timestamp(${rep.lastDecayAt / 1000}), ${rep.capDay}::date, ${rep.capPosToday},
       ${currentSeasonId()}, ${rep.seasonXp}, now())
    ON CONFLICT (org_id, user_id, domain) DO UPDATE SET
      role          = EXCLUDED.role,
      pos           = EXCLUDED.pos,
      neg           = EXCLUDED.neg,
      last_decay_at = EXCLUDED.last_decay_at,
      cap_day       = EXCLUDED.cap_day,
      cap_pos_today = EXCLUDED.cap_pos_today,
      season_xp     = EXCLUDED.season_xp,
      updated_at    = now()
  `;
}

// ---------------------------------------------------------------------------
// STAGE 1: record who contributed to a bullet
// ---------------------------------------------------------------------------

export type ContributionType =
  | 'INSERT_AUTHOR'
  | 'DEDUP_REINFORCE'
  | 'SUPERSEDE_AUTHOR'
  | 'MANUAL_CURATE';

const CONTRIBUTION_OUTCOME: Record<ContributionType, OutcomeType | null> = {
  INSERT_AUTHOR: 'CONTRIBUTED',
  DEDUP_REINFORCE: 'CONTRIBUTED',
  SUPERSEDE_AUTHOR: 'SUPERSEDED', // the author whose bullet got superseded
  MANUAL_CURATE: null, // provenance only, no reputation change
};

/**
 * Record a contribution AND apply the matching reputation outcome. Call from
 * curate.ts. `domain` is the bullet's agent_class. If the user can't be
 * resolved (anonymous run), this is a no-op.
 */
export async function recordContribution(args: {
  orgId: string;
  memoryId: string;
  domain: string; // agent_class of the bullet
  sessionId: string; // workbench session that produced it
  type: ContributionType;
  userId?: string; // pass if already known, else resolved from session
  cfg?: EngineConfig;
}): Promise<void> {
  const userId = args.userId ?? (await resolveContributorUserId(args.sessionId));
  if (!userId) return; // anonymous / unbound run — nothing to attribute

  await prisma.$executeRaw`
    INSERT INTO platform_memory_contributions
      (org_id, memory_id, user_id, domain, contribution_type, source_session_id)
    VALUES (${args.orgId}, ${args.memoryId}, ${userId}, ${args.domain}, ${args.type}, ${args.sessionId})
    ON CONFLICT (memory_id, user_id, contribution_type) DO NOTHING
  `;

  const outcome = CONTRIBUTION_OUTCOME[args.type];
  if (outcome) {
    await applyOutcomeForUser(args.orgId, userId, args.domain, outcome, args.cfg);
  }
  await refreshBulletMultiplier(args.orgId, args.memoryId, args.domain, args.cfg);
}

// ---------------------------------------------------------------------------
// STAGE 2: apply an outcome to a user's domain reputation
// ---------------------------------------------------------------------------

export async function applyOutcomeForUser(
  orgId: string,
  userId: string,
  domain: string,
  outcome: OutcomeType,
  cfg: EngineConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): Promise<DomainReputation> {
  const rep = await loadOrInit(orgId, userId, domain);
  const next = applyOutcome(rep, outcome, now, cfg);
  await persist(orgId, next);
  return next;
}

/**
 * Runtime attribution hook. Call from attributeRunOutcome() when an injected
 * bullet is judged helpful/harmful for a run. Resolves the user from the
 * session and the domain from the bullet, applies the outcome, and refreshes
 * the bullet's denormalised multiplier.
 */
export async function attributeOutcomeForRun(args: {
  orgId: string;
  sessionId: string;
  memoryId: string;
  outcome: 'HELPFUL' | 'HARMFUL';
  cfg?: EngineConfig;
}): Promise<void> {
  const userId = await resolveContributorUserId(args.sessionId);
  if (!userId) return;
  const domainRows = await prisma.$queryRaw<Array<{ agent_class: string }>>`
    SELECT agent_class FROM platform_agent_memory WHERE id = ${args.memoryId} LIMIT 1
  `;
  const domain = domainRows[0]?.agent_class;
  if (!domain) return;
  await applyOutcomeForUser(args.orgId, userId, domain, args.outcome, args.cfg);
  await refreshBulletMultiplier(args.orgId, args.memoryId, domain, args.cfg);
}

// ---------------------------------------------------------------------------
// STAGE 3: keep the bullet's contributor_rep multiplier in sync
// ---------------------------------------------------------------------------

/** Per-domain reputation summary for one user. */
export async function getDomainReputation(
  orgId: string,
  userId: string,
  domain: string,
  cfg: EngineConfig = DEFAULT_CONFIG,
): Promise<{ mean: number; evidence: number }> {
  const rep = await loadOrInit(orgId, userId, domain);
  return { mean: reputationMean(rep, cfg), evidence: evidenceCount(rep) };
}

/**
 * Recompute and store the denormalised contributor multiplier for a bullet.
 * Aggregates all its contributors' reputations IN THIS DOMAIN and caps the
 * ratio so no elite dominates. Called on every write that touches the bullet.
 */
export async function refreshBulletMultiplier(
  orgId: string,
  memoryId: string,
  domain: string,
  cfg: EngineConfig = DEFAULT_CONFIG,
): Promise<number> {
  const ids = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT DISTINCT user_id FROM platform_memory_contributions WHERE memory_id = ${memoryId}
  `;
  // Contributor counts per bullet are small, so resolve each Beta mean in app
  // code rather than trying to express it in SQL.
  const reps = await Promise.all(
    ids.map((row) => getDomainReputation(orgId, row.user_id, domain, cfg)),
  );
  const aggregate = aggregateContributorReputation(reps, cfg);
  const multiplier = repMultiplier(aggregate, cfg);
  await prisma.$executeRaw`
    UPDATE platform_agent_memory SET contributor_rep = ${multiplier} WHERE id = ${memoryId}
  `;
  return multiplier;
}
