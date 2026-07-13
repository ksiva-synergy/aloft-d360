/**
 * Per-domain reputation engine — PURE logic, no Prisma / no I/O.
 *
 * This is the heart of the "street cred" system. It is deliberately free of any
 * database or framework dependency so it can be unit-tested in isolation and
 * reused from API routes, the nightly sweep, or the attribution loop.
 *
 * Domain model
 * ------------
 * "Domain" = the axis along which credibility is tracked separately. In this
 * codebase the natural domain is `agentClass` (stable, bounded, already part of
 * the platform_agent_memory key). `taskSignature` is a finer grain you can turn
 * on later by using it as the domain key instead — the math is identical.
 *
 * Reputation model (Bayesian Beta, per user per domain)
 * -----------------------------------------------------
 *   alpha = pos + W * a          beta = neg + W * (1 - a)
 *   mean  = alpha / (alpha + beta) = (pos + W*a) / (pos + neg + W)
 *
 *   - a  (prior mean)   : the role-based prior — what we assume about a user of
 *                          this role BEFORE they have a track record.
 *   - W  (prior weight) : how many "free" validated observations the role prior
 *                          is worth. Earned evidence overrides the prior once the
 *                          user accumulates ~W validated outcomes.
 *   - pos / neg         : time-decayed sums of positive / negative evidence.
 *
 * This is exactly the "combine a role prior with earned evidence" mechanism from
 * the research (Beta pseudocounts / Jøsang reputation): a brand-new user starts
 * at their role prior in every domain and earns their way up domain by domain.
 */

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

export interface RolePrior {
  /** Prior mean `a` in (0,1): assumed quality for this role before evidence. */
  mean: number;
  /** Prior weight `W`: pseudo-observations the role prior is worth. */
  weight: number;
}

/**
 * Role priors. `role` is whatever string you resolve for a user (AAD group,
 * a `role` column you add to `users`, etc.). Unknown roles fall back to DEFAULT.
 * Keep the spread modest so role never dominates earned behaviour for long.
 */
export const ROLE_PRIORS: Record<string, RolePrior> = {
  founder: { mean: 0.72, weight: 8 },
  senior: { mean: 0.64, weight: 5 },
  member: { mean: 0.55, weight: 3 },
  contributor: { mean: 0.52, weight: 3 },
  external: { mean: 0.48, weight: 2 },
  new: { mean: 0.5, weight: 2 },
};

export const DEFAULT_ROLE = 'member';

export interface EngineConfig {
  /** Half-life (days) for time decay of evidence. */
  halfLifeDays: number;
  /** Max positive evidence a user can bank per domain per calendar day. */
  dailyPositiveCap: number;
  /** Evidence count below which a user is shown as "provisional". */
  provisionalThreshold: number;
  /**
   * Max ratio between the highest and lowest reputation multiplier applied in
   * retrieval. Caps how much a high-cred elite can dominate learned memory
   * (fairness / anti-Matthew-effect guardrail). 4 => multiplier in [0.4, 1.6].
   */
  weightRatioCap: number;
  /** Smoothing added to evidence count when confidence-weighting contributors. */
  contributorSmoothing: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  halfLifeDays: 120,
  dailyPositiveCap: 20,
  provisionalThreshold: 3,
  weightRatioCap: 4,
  contributorSmoothing: 1,
};

/** Signed magnitude of each outcome type. Harm is penalised more than help. */
export const OUTCOME_WEIGHTS = {
  HELPFUL: 1.0, // injected bullet led to a good run outcome
  HARMFUL: -1.5, // injected bullet led to a bad run outcome (asymmetric)
  SURVIVED: 2.0, // bullet survived past its TTL / relied on repeatedly
  CONTRIBUTED: 0.5, // participated in a new INSERT (small participation credit)
  SUPERSEDED: -0.5, // a user's bullet was replaced by a better one
} as const;

export type OutcomeType = keyof typeof OUTCOME_WEIGHTS;

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------

/** Persisted reputation aggregate for one (user, domain). Decay applied lazily. */
export interface DomainReputation {
  userId: string;
  domain: string;
  role: string;
  pos: number; // decayed positive evidence
  neg: number; // decayed negative evidence
  lastDecayAt: number; // epoch ms of last decay application
  capDay: string; // YYYY-MM-DD of the current daily-cap bucket
  capPosToday: number; // positive evidence already banked in capDay
  seasonXp: number; // motivational leaderboard XP for the current season
}

export function newDomainReputation(
  userId: string,
  domain: string,
  role: string,
  now: number = Date.now(),
): DomainReputation {
  return {
    userId,
    domain,
    role,
    pos: 0,
    neg: 0,
    lastDecayAt: now,
    capDay: dayKey(now),
    capPosToday: 0,
    seasonXp: 0,
  };
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Core math
// ----------------------------------------------------------------------------

/** Lazily decay pos/neg to `now` using the configured half-life. Mutates copy. */
export function decayTo(
  rep: DomainReputation,
  now: number,
  cfg: EngineConfig = DEFAULT_CONFIG,
): DomainReputation {
  const elapsedDays = (now - rep.lastDecayAt) / 86_400_000;
  if (elapsedDays <= 0) return { ...rep };
  const factor = Math.pow(0.5, elapsedDays / cfg.halfLifeDays);
  return { ...rep, pos: rep.pos * factor, neg: rep.neg * factor, lastDecayAt: now };
}

/**
 * Apply one outcome to a user's domain reputation. Returns a NEW object.
 * Positive evidence is subject to the daily cap (anti-grind); negative evidence
 * is never capped (safety — harm always registers).
 */
export function applyOutcome(
  rep: DomainReputation,
  outcome: OutcomeType,
  now: number = Date.now(),
  cfg: EngineConfig = DEFAULT_CONFIG,
): DomainReputation {
  const next = decayTo(rep, now, cfg);
  const today = dayKey(now);
  if (next.capDay !== today) {
    next.capDay = today;
    next.capPosToday = 0;
  }
  const delta = OUTCOME_WEIGHTS[outcome];
  if (delta > 0) {
    const room = Math.max(0, cfg.dailyPositiveCap - next.capPosToday);
    const allowed = Math.min(delta, room);
    next.pos += allowed;
    next.capPosToday += allowed;
    next.seasonXp += allowed; // season XP tracks banked positive only
  } else {
    next.neg += -delta;
  }
  return next;
}

/** Posterior mean reputation in (0,1) for a user's domain. */
export function reputationMean(
  rep: DomainReputation,
  cfg: EngineConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): number {
  const d = decayTo(rep, now, cfg);
  const prior = ROLE_PRIORS[rep.role] ?? ROLE_PRIORS[DEFAULT_ROLE];
  const alpha = d.pos + prior.weight * prior.mean;
  const beta = d.neg + prior.weight * (1 - prior.mean);
  return alpha / (alpha + beta);
}

/** Amount of earned evidence — how "settled" the score is. */
export function evidenceCount(rep: DomainReputation): number {
  return rep.pos + rep.neg;
}

/** Human-facing street-cred number (0–100) plus provisional flag. */
export function streetCred(
  rep: DomainReputation,
  cfg: EngineConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): { score: number; provisional: boolean } {
  return {
    score: Math.round(reputationMean(rep, cfg, now) * 100),
    provisional: evidenceCount(rep) < cfg.provisionalThreshold,
  };
}

/**
 * Map a reputation mean in [0,1] to a retrieval multiplier centred on 1.0.
 * With ratioCap = R: mean 0 -> lo, mean 0.5 -> 1.0, mean 1 -> hi, hi/lo = R.
 * The cap prevents a small high-cred elite from dominating learned memory.
 */
export function repMultiplier(mean: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  const R = cfg.weightRatioCap;
  const lo = 2 / (1 + R);
  const hi = (2 * R) / (1 + R);
  return lo + (hi - lo) * clamp01(mean);
}

/**
 * A memory bullet can have several contributors. Combine their per-domain
 * reputations into one score using a confidence-weighted mean, so a bullet
 * backed by a proven contributor ranks above one from only unproven authors,
 * but a single high-cred name can't fully mask many weak ones.
 */
export function aggregateContributorReputation(
  contributors: Array<{ mean: number; evidence: number }>,
  cfg: EngineConfig = DEFAULT_CONFIG,
): number {
  if (contributors.length === 0) return 0.5; // neutral when we know nothing
  let num = 0;
  let den = 0;
  for (const c of contributors) {
    const w = c.evidence + cfg.contributorSmoothing;
    num += c.mean * w;
    den += w;
  }
  return den === 0 ? 0.5 : num / den;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
