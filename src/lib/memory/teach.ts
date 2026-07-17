/**
 * src/lib/memory/teach.ts
 *
 * Phase 3.5D — a THIN, user-facing write path into agent memory for standing
 * rules a person teaches Inspector ("always exclude internal test accounts",
 * "fiscal year starts in April", "when someone says 'active' they mean
 * status='A'").
 *
 * WHY A NEW PATH (flagged in 3.5D): the existing insert path, curate() in
 * synthesis/, is hard-coupled to the reflect→trace→signature agent-run pipeline
 * and enforces a phantom gate that requires the rule's identifiers to appear in
 * a real agent trace. A directly-authored rule has no such trace, so it cannot
 * go through curate(). This module writes one bullet into the SAME table
 * (platform_agent_memory) via the same embedding path (embedQuery), just without
 * the run-attribution coupling.
 *
 * GOVERNANCE (same ladder as metrics):
 *   - teachRule() creates a PERSONAL rule (visibility='personal', created_by=you)
 *     — free, applies only to your own sessions.
 *   - promoteRuleToOrg() flips it to org-wide — reputation-gated via the shared
 *     promotion-gate, and credits the author's semantic_authoring reputation.
 *
 * RULE TYPE — why SCHEMA_MAP by default: retrieval injects Phase 0 HARD_RULEs
 * only once they have a real harmful hit (PHASE0_MIN_HARMFUL=1), so a freshly
 * taught HARD_RULE would never surface. Phase 1a SCHEMA_MAP bullets with a NULL
 * task_signature are injected globally with no confidence/harmful gate — the
 * only path that makes a brand-new standing rule reliably "apply for everyone".
 */

import 'server-only';
import { createId } from '@paralleldrive/cuid2';
import prisma from '@/lib/db';
import { embedQuery } from '@/lib/context/embed';
import { creditAuthoringPromotion, evaluatePromotionEligibility, isAdmin } from '@/lib/semantic/promotion-gate';

export const INSPECTOR_MEMORY_CLASS = 'inspector';

export type TeachableRuleType = 'SCHEMA_MAP' | 'HARD_RULE' | 'HEURISTIC' | 'SOURCE_PREF' | 'FAILURE_MODE';

export interface TeachRuleArgs {
  orgId: string;
  userId: string;
  ruleText: string;
  agentClass?: string; // default 'inspector'
  ruleType?: TeachableRuleType; // default 'SCHEMA_MAP' (see module header)
}

export interface TaughtRule {
  id: string;
  ruleText: string;
  ruleType: string;
  visibility: string;
  status: string;
  agentClass: string;
  createdAt: Date;
}

/**
 * Create a PERSONAL standing rule (free). Applies only to the author's own
 * Inspector sessions until promoted. Embedding is best-effort (a rule without an
 * embedding still injects via Phase 1a; only Phase 1b cosine recall needs it).
 */
export async function teachRule(args: TeachRuleArgs): Promise<TaughtRule> {
  const agentClass = args.agentClass ?? INSPECTOR_MEMORY_CLASS;
  const ruleType = args.ruleType ?? 'SCHEMA_MAP';
  const text = args.ruleText.trim();
  if (!text) throw new Error('ruleText is required');

  const id = createId();
  await prisma.platformAgentMemory.create({
    data: {
      id,
      orgId: args.orgId,
      agentClass,
      taskSignature: null, // global — applies regardless of the current task
      ruleText: text,
      ruleType,
      confidence: 0.9, // user-authored; high but below a proven guardrail
      embedText: text,
      sourceSessionIds: [],
      status: 'ACTIVE',
      shortLabel: text.length > 48 ? `${text.slice(0, 47)}…` : text,
      createdBy: args.userId,
      visibility: 'personal',
    },
  });

  // Best-effort embedding (Prisma can't bind a vector literal — raw update).
  try {
    const vec = await embedQuery(text);
    if (vec) {
      const vecStr = `[${vec.join(',')}]`;
      await prisma.$executeRaw`
        UPDATE platform_agent_memory SET embedding = ${vecStr}::text::vector WHERE id = ${id}
      `;
    }
  } catch (err) {
    console.warn('[teach.teachRule] embedding failed (non-fatal)', err);
  }

  return {
    id,
    ruleText: text,
    ruleType,
    visibility: 'personal',
    status: 'ACTIVE',
    agentClass,
    createdAt: new Date(),
  };
}

export interface PromoteRuleResult {
  ok: boolean;
  reason: string;
}

/**
 * Promote a personal rule to org-wide (the agent applies it for everyone).
 * Reputation-gated exactly like a metric promotion: admin OR a self-approve-
 * eligible author. On success, credits the author's semantic_authoring
 * reputation — teaching the org a good rule builds authoring reputation, same as
 * authoring a good metric (one reputation loop for all contribution types).
 *
 * Only the RULE'S OWN author (or an admin) may promote it — a personal rule is
 * owned by its creator.
 */
export async function promoteRuleToOrg(
  ruleId: string,
  orgId: string,
  actingUserId: string,
): Promise<PromoteRuleResult> {
  const rule = await prisma.platformAgentMemory.findFirst({
    where: { id: ruleId, orgId },
    select: { id: true, createdBy: true, visibility: true, status: true },
  });
  if (!rule) return { ok: false, reason: 'rule not found' };
  if (rule.visibility === 'org') return { ok: true, reason: 'already org-wide' };

  const admin = await isAdmin(actingUserId);
  // Only the author (or an admin) may promote their own rule.
  if (!admin && rule.createdBy !== actingUserId) {
    return { ok: false, reason: 'only the rule author or an admin may promote it' };
  }

  // Same gate as candidate → governed metric promotion.
  const eligibility = await evaluatePromotionEligibility(actingUserId, orgId);
  if (!admin && !eligibility.canSelfApprove) {
    return { ok: false, reason: eligibility.reason };
  }

  await prisma.platformAgentMemory.update({
    where: { id: ruleId },
    data: { visibility: 'org', updatedAt: new Date() },
  });

  // Credit the CONTRIBUTOR (the rule's author), not necessarily the admin who
  // blessed it — the reputation belongs to whoever taught the rule.
  await creditAuthoringPromotion(orgId, rule.createdBy ?? actingUserId);

  return { ok: true, reason: admin ? 'admin override' : eligibility.reason };
}

/** List the rules a user has taught (personal + their promoted-to-org rules). */
export async function listMyRules(
  orgId: string,
  userId: string,
  agentClass: string = INSPECTOR_MEMORY_CLASS,
): Promise<TaughtRule[]> {
  const rows = await prisma.platformAgentMemory.findMany({
    where: { orgId, agentClass, createdBy: userId, status: { not: 'SUPERSEDED' } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      ruleText: true,
      ruleType: true,
      visibility: true,
      status: true,
      agentClass: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    ruleText: r.ruleText,
    ruleType: r.ruleType,
    visibility: r.visibility,
    status: r.status,
    agentClass: r.agentClass,
    createdAt: r.createdAt,
  }));
}

/** Retire a personal rule the user taught (soft delete → SUPERSEDED). */
export async function retireMyRule(
  ruleId: string,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const rule = await prisma.platformAgentMemory.findFirst({
    where: { id: ruleId, orgId, createdBy: userId },
    select: { id: true },
  });
  if (!rule) return false;
  await prisma.platformAgentMemory.update({
    where: { id: ruleId },
    data: { status: 'SUPERSEDED', updatedAt: new Date() },
  });
  return true;
}
