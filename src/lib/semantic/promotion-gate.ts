/**
 * src/lib/semantic/promotion-gate.ts
 *
 * Phase 3.5A — reputation-gated promotion (candidate → governed).
 *
 * Trust model: users build (draft) freely and EARN governance rights through
 * demonstrated, validated authoring. Promotion of a candidate to `governed`
 * is gated on the contributor's reputation in the NEW `semantic_authoring`
 * domain, with an admin override that always satisfies the gate.
 *
 * DAY-ONE BEHAVIOR (by construction, not by a flag): the semantic_authoring
 * domain starts empty, so every non-admin is `provisional` and cannot
 * self-approve. Promotion is therefore admin-only in practice until real
 * authoring reputation accrues — at which point the gate opens progressively
 * with zero code change.
 *
 * Uses the VERIFIED reputation primitives (the handoff's assumed names were
 * guesses; these are the real ones):
 *   - getDomainReputation(orgId, userId, domain) → { mean, evidence }
 *       score      = round(mean * 100)          (0–100, mirrors streetCred())
 *       provisional = evidence < provisionalThreshold (3)
 *   - applyOutcomeForUser(orgId, userId, domain, outcome) for the promotion credit
 *   - isAdmin() below queries user_roles → roles DIRECTLY. NOTE: resolveRole()
 *     is NOT used for the admin check — it returns reputation-PRIOR keys
 *     (founder|senior|member|external) and never yields 'admin', so using it
 *     for the override would be a real bug.
 */

import prisma from '@/lib/db';
import { getDomainReputation, applyOutcomeForUser } from '@/lib/memory/reputation/store';
import { DEFAULT_CONFIG } from '@/lib/memory/reputation/engine';

// ── Named, conservatively-defaulted thresholds ──────────────────────────────
// DO NOT tune now. Live semantic_authoring reputation is empty (everyone
// provisional), so these are irrelevant to day-one behavior. Re-verify the
// live reputation distribution before EVER lowering the self-approve bar.
export const SELF_APPROVE_STREETCRED_THRESHOLD = 80; // conservative; provisional users never reach this
export const MIN_QUORUM_REPUTATION = 120; // summed approver streetCred needed if not self-approving
export const REPUTATION_DOMAIN = 'semantic_authoring'; // NEW domain — starts empty

/** RBAC role names that count as admin for the governance override. */
const ADMIN_ROLE_NAMES = ['admin', 'platform_admin'];

export interface PromotionEligibility {
  canSelfApprove: boolean; // the contributor's own reputation clears the self-approve bar
  requiresApprovers: boolean; // needs approver quorum instead
  minApproverReputation: number; // summed approver streetCred required if not self-approving
  reason: string; // human-readable explanation for the UI / audit
}

export interface ApproverStanding {
  isAdmin: boolean;
  score: number; // streetCred 0–100 in semantic_authoring
}

export interface QuorumResult {
  satisfied: boolean;
  totalReputation: number;
  hasAdmin: boolean;
}

// ── isAdmin — RBAC role resolution (direct, not via resolveRole) ─────────────

/**
 * True iff the user holds an `admin` or `platform_admin` RBAC role. Mirrors
 * resolveRole()'s raw query but checks membership directly. Defensive: any
 * error → false (deny), the safe direction for a governance gate.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ${userId} AND r.name IN ('admin', 'platform_admin')
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

// keep ADMIN_ROLE_NAMES referenced for callers/tests that want the canonical list
export { ADMIN_ROLE_NAMES };

// ── streetCred derivation from the real read API ─────────────────────────────

/** Derive streetCred {score, provisional} for a user in semantic_authoring. */
export async function getAuthoringStreetCred(
  orgId: string,
  userId: string,
): Promise<{ score: number; provisional: boolean }> {
  const { mean, evidence } = await getDomainReputation(orgId, userId, REPUTATION_DOMAIN);
  return {
    score: Math.round(mean * 100),
    provisional: evidence < DEFAULT_CONFIG.provisionalThreshold,
  };
}

// ── Pure decision cores (unit-tested without I/O) ────────────────────────────

/**
 * Pure eligibility decision. Inputs are already-resolved standing facts.
 *   admin                          → self-approve (admin override)
 *   provisional (or rep disabled)  → cannot self-approve; only admin approval
 *                                    satisfies quorum (no non-admin authoring rep yet)
 *   score ≥ self-approve threshold → self-approve
 *   otherwise                      → needs approver quorum (MIN_QUORUM_REPUTATION)
 */
export function decidePromotionEligibility(input: {
  isAdmin: boolean;
  score: number;
  provisional: boolean;
}): PromotionEligibility {
  if (input.isAdmin) {
    return {
      canSelfApprove: true,
      requiresApprovers: false,
      minApproverReputation: 0,
      reason: 'admin override',
    };
  }
  if (input.provisional) {
    return {
      canSelfApprove: false,
      requiresApprovers: true,
      minApproverReputation: MIN_QUORUM_REPUTATION,
      reason:
        'provisional in semantic_authoring — promotion requires admin approval ' +
        '(no non-admin authoring reputation exists yet)',
    };
  }
  if (input.score >= SELF_APPROVE_STREETCRED_THRESHOLD) {
    return {
      canSelfApprove: true,
      requiresApprovers: false,
      minApproverReputation: 0,
      reason: `self-approve (streetCred ${input.score} ≥ ${SELF_APPROVE_STREETCRED_THRESHOLD})`,
    };
  }
  return {
    canSelfApprove: false,
    requiresApprovers: true,
    minApproverReputation: MIN_QUORUM_REPUTATION,
    reason: `streetCred ${input.score} below self-approve threshold ${SELF_APPROVE_STREETCRED_THRESHOLD} — needs approver quorum`,
  };
}

/**
 * Pure quorum decision. An admin approver ALWAYS satisfies quorum (admin
 * override); otherwise the summed approver streetCred must meet the minimum.
 */
export function decideApprovalQuorum(approvers: ApproverStanding[]): QuorumResult {
  const hasAdmin = approvers.some((a) => a.isAdmin);
  const totalReputation = approvers.reduce((sum, a) => sum + a.score, 0);
  return {
    satisfied: hasAdmin || totalReputation >= MIN_QUORUM_REPUTATION,
    totalReputation,
    hasAdmin,
  };
}

// ── Async wrappers (resolve standing, then apply the pure core) ──────────────

/**
 * Evaluate whether `contributorUserId` may have their candidate promoted.
 * `reputationEnabled` defaults to the MEMORY_REPUTATION_ENABLED flag; when the
 * flag is off, non-admins are treated as provisional (cannot self-approve),
 * matching the reputation subsystem's flag convention.
 */
export async function evaluatePromotionEligibility(
  contributorUserId: string,
  orgId: string,
  reputationEnabled: boolean = process.env.MEMORY_REPUTATION_ENABLED === 'true',
): Promise<PromotionEligibility> {
  const admin = await isAdmin(contributorUserId);
  if (admin) {
    return decidePromotionEligibility({ isAdmin: true, score: 0, provisional: true });
  }
  if (!reputationEnabled) {
    // Flag off → no reputation to earn on → treat as provisional (admin-only).
    return decidePromotionEligibility({ isAdmin: false, score: 0, provisional: true });
  }
  const { score, provisional } = await getAuthoringStreetCred(orgId, contributorUserId);
  return decidePromotionEligibility({ isAdmin: false, score, provisional });
}

/**
 * Evaluate whether a set of approvers satisfies the promotion quorum. Included
 * for 3.5B's PR-style review UI; in 3.5A (quorum tables deferred) the promote
 * route relies on self-approve + admin override, but the pure decision is the
 * gate's canonical companion.
 */
export async function evaluateApprovalQuorum(
  approverUserIds: string[],
  orgId: string,
): Promise<QuorumResult> {
  const approvers: ApproverStanding[] = await Promise.all(
    approverUserIds.map(async (uid) => {
      const [admin, cred] = await Promise.all([
        isAdmin(uid),
        getAuthoringStreetCred(orgId, uid),
      ]);
      return { isAdmin: admin, score: cred.score };
    }),
  );
  return decideApprovalQuorum(approvers);
}

// ── Reputation attribution — close the trust loop ────────────────────────────

/** A promotion target as far as credit attribution is concerned. */
export interface PromotionTarget {
  id: string;
  created_by: string | null;
}

/**
 * Select the DISTINCT author ids to credit for a promotion.
 *
 * The credit follows the ROW AUTHOR (`created_by`), NEVER the caller/approver:
 * an admin promoting someone else's candidate must credit that candidate's
 * author, not themselves. This is the seam the promote route relies on, factored
 * out so the "who gets credited" property is unit-testable without a route
 * harness — the exact weak-assertion trap (assert the user + delta, not row
 * existence) called out for this phase.
 *
 * Rules:
 *   - only rows that ACTUALLY promoted (`promotedIds`) count — a target that
 *     failed to promote credits nobody;
 *   - a row with no author (`created_by == null`) credits nobody;
 *   - authors are deduped, so a multi-row promotion by one author credits once.
 */
export function selectAuthoringCreditRecipients(
  targets: PromotionTarget[],
  promotedIds: Iterable<string>,
): string[] {
  const promoted = new Set(promotedIds);
  const authors = new Set(
    targets
      .filter((t) => promoted.has(t.id) && t.created_by)
      .map((t) => t.created_by as string),
  );
  return [...authors];
}

/**
 * Credit a contributor for a definition successfully promoted to `governed`.
 * This is what makes the system's trust grow with demonstrated, validated
 * authoring. Uses the domain-level Beta primitive `applyOutcomeForUser`
 * (NOT recordContribution, which is coupled to memory bullets). Gated on the
 * MEMORY_REPUTATION_ENABLED flag and fully non-fatal — a reputation write must
 * never fail a promotion.
 */
export async function creditAuthoringPromotion(orgId: string, contributorUserId: string): Promise<void> {
  if (process.env.MEMORY_REPUTATION_ENABLED !== 'true') return;
  try {
    await applyOutcomeForUser(orgId, contributorUserId, REPUTATION_DOMAIN, 'CONTRIBUTED');
  } catch (err) {
    console.error('[promotion-gate creditAuthoringPromotion] non-fatal', err);
  }
}
