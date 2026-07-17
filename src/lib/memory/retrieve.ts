/**
 * AM2.1 — Operating Memory retrieval + injection.
 *
 * Three-phase, token-budgeted retrieval of platform_agent_memory bullets.
 *
 *   Phase 0 (INIT): Fatal HARD_RULEs only (confidence >= 0.9, harmfulCount >= 1).
 *     No embedding. Appended to system prompt.
 *
 *   Phase 1a (SCHEMA_GLOBAL): All SCHEMA_MAP bullets for the agent class,
 *     filtered to the inferred topic group (topicKey). No cosine search —
 *     all matching bullets sorted by score, token-capped. Appended to system prompt.
 *
 *   Phase 1b (TASK_SCOPED): HEURISTIC / SOURCE_PREF / FAILURE_MODE bullets
 *     retrieved via pgvector cosine search against the task context embedding.
 *     Injected as a synthetic assistant recall turn.
 *
 * Feature flags (env vars, checked synchronously — zero async on flag-off):
 *   MEMORY_INJECT_ENABLED       — must equal 'true' (default: 'false')
 *   MEMORY_INJECT_CLASSES       — comma-separated allowlist of agent class IDs
 *   MEMORY_PHASE1A_BUDGET       — token budget for Phase 1a (default: 600)
 *   MEMORY_PHASE1B_BUDGET       — token budget for Phase 1b (default: 1200)
 *   MEMORY_P1B_FULLPOOL         — master switch for M5 sparse-recall fix (default: 'false')
 *   MEMORY_P1B_FULLPOOL_ORGS    — comma-separated org ID canary allowlist for FULLPOOL.
 *                                  Empty/unset = all orgs when FULLPOOL=true.
 *                                  Set to a single org ID to run a measured canary.
 */

import { prisma } from '@/lib/prisma';
import { embedQuery } from '@/lib/context/embed';
import type { ConstructionState } from '@/lib/construction/constructionState';
import {
  MemoryPhase,
  getPhaseBudget,
  PHASE_RULE_TYPES,
  PHASE_TIER1_CAP,
  PHASE0_CONFIDENCE_FLOOR,
  PHASE0_MIN_HARMFUL,
} from './phases';
import { mmrSelect, parsePgVector, type DiversityCandidate } from './diversity';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Used when no phase is specified (legacy callers). */
const DEFAULT_BUDGET_TOKENS = 2000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemoryBullet {
  id:           string;
  ruleText:     string;
  ruleType:     string;
  confidence:   number;
  helpfulCount: number;
  harmfulCount: number;
}

interface HardRuleRow {
  id:            string;
  rule_text:     string;
  rule_type:     string;
  confidence:    number;
  helpful_count: number;
  harmful_count: number;
}

interface CosineSimilarityRow extends HardRuleRow {
  distance: number;
  embedding_txt?: string;
}

// ── Token budget helper ───────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function parseConfidence(v: number | unknown): number {
  return typeof v === 'number' ? v : parseFloat(v as string);
}

// ── Feature flag guard ────────────────────────────────────────────────────────

export function isMemoryInjectionEnabled(agentClass: string | undefined): boolean {
  if (process.env.MEMORY_INJECT_ENABLED !== 'true') return false;
  if (!agentClass) return false;
  const allowed = (process.env.MEMORY_INJECT_CLASSES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(agentClass);
}

/**
 * Returns true when MEMORY_P1B_FULLPOOL=true AND the given orgId is within
 * the canary allowlist (MEMORY_P1B_FULLPOOL_ORGS).
 *
 * Canary gating logic (fail-closed):
 *   - MEMORY_P1B_FULLPOOL != 'true'  → false (master switch is off)
 *   - MEMORY_P1B_FULLPOOL_ORGS unset or empty → false (nobody gets it)
 *   - MEMORY_P1B_FULLPOOL_ORGS set  → true only for orgs in the list
 *
 * Empty allowlist = fail-closed (nobody). An explicit opt-in is required.
 * This prevents a deploy that sets MEMORY_P1B_FULLPOOL=true without the
 * org list from silently becoming a global rollout.
 *
 * This mirrors the MEMORY_INJECT_CLASSES pattern exactly so rollout
 * can be widened by editing a single env var without a deploy.
 */
export function isFullPoolEnabled(orgId: string): boolean {
  if (process.env.MEMORY_P1B_FULLPOOL !== 'true') return false;
  const canaryOrgs = (process.env.MEMORY_P1B_FULLPOOL_ORGS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (canaryOrgs.length === 0) return false;
  return canaryOrgs.includes(orgId);
}

// ── Task context extractor ────────────────────────────────────────────────────

export function extractTaskContext(
  messages: Array<{ role: string; content: string }> | undefined,
  constructionParsedState: ConstructionState | null,
): string {
  const instructions = constructionParsedState?.prompt?.instructions?.trim();
  if (instructions && instructions.length > 0) return instructions.slice(0, 500);
  if (Array.isArray(messages)) {
    const firstUser = messages.find((m) => m.role === 'user' && m.content?.trim());
    if (firstUser) return firstUser.content.trim().slice(0, 500);
  }
  return '';
}

// ── Default guardrail (always present, even when DB returns no HARD_RULEs) ───

const DEFAULT_GUARDRAIL: MemoryBullet = {
  id:           '__default_guardrail__',
  ruleText:     'Before acting, verify that requested tables/columns exist in the schema context provided. Never fabricate column names, never assume a JOIN path without confirming foreign-key relationships, and always prefer explicit casting over implicit type coercion.',
  ruleType:     'HARD_RULE',
  confidence:   1.0,
  helpfulCount: 100,
  harmfulCount: 0,
};

// ── Phase-specific retrieval ──────────────────────────────────────────────────

/**
 * Sentinel for "no caller resolved" — never equals a real created_by, so
 * retrieval falls back to org-visible rows only. Personal rules are fail-closed:
 * absent a known caller, no personal-scoped rule is ever surfaced.
 */
const NO_USER_SENTINEL = '__no_user__';

/**
 * SQL visibility clause (Phase 3.5D). A bullet is visible if it is org-wide
 * (the pre-3.5D default) OR it is the caller's own personal rule. Personal
 * rules always carry visibility='personal' + created_by=<owner>, so this never
 * leaks one user's rule into another user's context.
 *
 * `paramIndex` is the positional placeholder ($N) that carries callerUserId.
 */
function visibilityClause(paramIndex: number): string {
  return `AND (visibility = 'org' OR created_by = $${paramIndex})`;
}

/**
 * Phase 0 — Fatal HARD_RULEs + default guardrail.
 *
 * Always returns at least the default instructional guardrail. Additional
 * DB-stored rules are included when they meet the confidence/harmful gate.
 */
async function selectPhase0(
  orgId:        string,
  agentClass:   string,
  callerUserId: string = NO_USER_SENTINEL,
): Promise<MemoryBullet[]> {
  const budget   = getPhaseBudget(MemoryPhase.INIT);
  const cap      = PHASE_TIER1_CAP[MemoryPhase.INIT];

  const result: MemoryBullet[] = [DEFAULT_GUARDRAIL];
  let used = estimateTokens(DEFAULT_GUARDRAIL.ruleText);

  try {
    const rows = await prisma.$queryRawUnsafe<HardRuleRow[]>(`
      SELECT id, rule_text, rule_type,
             confidence::float AS confidence,
             helpful_count, harmful_count
      FROM platform_agent_memory
      WHERE
        org_id      = $1
        AND agent_class = $2
        AND status      = 'ACTIVE'
        AND rule_type   = 'HARD_RULE'
        AND confidence  >= $3
        AND harmful_count >= $4
        ${visibilityClause(6)}
      ORDER BY confidence * GREATEST(helpful_count - harmful_count, 0) DESC
      LIMIT $5
    `, orgId, agentClass, PHASE0_CONFIDENCE_FLOOR, PHASE0_MIN_HARMFUL, cap, callerUserId);

    for (const row of rows) {
      const tokens = estimateTokens(row.rule_text);
      if (used + tokens > budget) break;
      result.push({
        id:           row.id,
        ruleText:     row.rule_text,
        ruleType:     row.rule_type,
        confidence:   parseConfidence(row.confidence),
        helpfulCount: Number(row.helpful_count),
        harmfulCount: Number(row.harmful_count),
      });
      used += tokens;
    }
    return result;
  } catch (err) {
    console.warn('[memory/retrieve] Phase 0 query failed (non-fatal):', err instanceof Error ? err.message : String(err));
    return result;
  }
}

/**
 * Phase 1a — Topic-group SCHEMA_MAPs.
 *
 * Fetches all ACTIVE SCHEMA_MAP bullets for the agent class. When topicKey is
 * provided, restricts to bullets whose task_signature belongs to that topic group
 * (via platform_memory_topics) OR has no task_signature (global schema facts).
 *
 * No cosine search — deterministic, sorted by confidence × net-helpful score.
 */
async function selectPhase1a(
  orgId:        string,
  agentClass:   string,
  topicKey:     string | null,
  callerUserId: string = NO_USER_SENTINEL,
): Promise<MemoryBullet[]> {
  const budget = getPhaseBudget(MemoryPhase.SCHEMA_GLOBAL);
  const cap    = PHASE_TIER1_CAP[MemoryPhase.SCHEMA_GLOBAL];

  try {
    let rows: HardRuleRow[];

    if (topicKey) {
      // Restrict to signatures within the topic group, or global (null signature).
      rows = await prisma.$queryRawUnsafe<HardRuleRow[]>(`
        SELECT id, rule_text, rule_type,
               confidence::float AS confidence,
               helpful_count, harmful_count
        FROM platform_agent_memory
        WHERE
          org_id      = $1
          AND agent_class = $2
          AND status      = 'ACTIVE'
          AND rule_type   = 'SCHEMA_MAP'
          AND (
            task_signature IS NULL
            OR task_signature IN (
              SELECT DISTINCT task_signature
              FROM platform_memory_topics
              WHERE org_id = $1 AND topic_key = $3
            )
          )
          ${visibilityClause(5)}
        ORDER BY confidence * GREATEST(helpful_count - harmful_count, 0) DESC
        LIMIT $4
      `, orgId, agentClass, topicKey, cap, callerUserId);
    } else {
      // No topic context — fetch top global SCHEMA_MAPs.
      rows = await prisma.$queryRawUnsafe<HardRuleRow[]>(`
        SELECT id, rule_text, rule_type,
               confidence::float AS confidence,
               helpful_count, harmful_count
        FROM platform_agent_memory
        WHERE
          org_id      = $1
          AND agent_class = $2
          AND status      = 'ACTIVE'
          AND rule_type   = 'SCHEMA_MAP'
          ${visibilityClause(4)}
        ORDER BY confidence * GREATEST(helpful_count - harmful_count, 0) DESC
        LIMIT $3
      `, orgId, agentClass, cap, callerUserId);
    }

    const result: MemoryBullet[] = [];
    let used = 0;
    for (const row of rows) {
      const tokens = estimateTokens(row.rule_text);
      if (used + tokens > budget && result.length > 0) break;
      result.push({
        id:           row.id,
        ruleText:     row.rule_text,
        ruleType:     row.rule_type,
        confidence:   parseConfidence(row.confidence),
        helpfulCount: Number(row.helpful_count),
        harmfulCount: Number(row.harmful_count),
      });
      used += tokens;
    }
    return result;
  } catch (err) {
    console.warn('[memory/retrieve] Phase 1a query failed (non-fatal):', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Phase 1b — Task-scoped contextual recall.
 *
 * Cosine search over HEURISTIC / SOURCE_PREF / FAILURE_MODE bullets,
 * excluding any IDs already returned in earlier phases to avoid duplication.
 *
 * When MEMORY_MMR_ENABLED=true, widens the candidate pool and applies
 * Maximal Marginal Relevance re-ranking for diversity before budget packing.
 *
 * When MEMORY_P1B_FULLPOOL=true AND orgId is in the MEMORY_P1B_FULLPOOL_ORGS
 * canary allowlist (or the list is empty), removes the hard SQL distance floor
 * so MMR sees the full top-40 candidate pool. A loose sanity cut (< 0.8) remains
 * to drop true garbage. The 0.35-equivalent floor is then applied post-MMR at
 * injection time via MEMORY_P1B_FLOOR (default 0.65 == 1 - 0.35), preserving
 * "inject nothing rather than junk" without starving MMR's pool.
 * Flag OFF or org not in canary = exact legacy behavior (hard pre-filter in SQL).
 */
async function selectPhase1b(
  orgId:        string,
  agentClass:   string,
  taskContext:  string,
  excludeIds:   string[],
  callerUserId: string = NO_USER_SENTINEL,
): Promise<MemoryBullet[]> {
  const budget    = getPhaseBudget(MemoryPhase.TASK_SCOPED);
  const ruleTypes = PHASE_RULE_TYPES[MemoryPhase.TASK_SCOPED];
  const mmrEnabled     = process.env.MEMORY_MMR_ENABLED     === 'true';
  const fullPoolEnabled = isFullPoolEnabled(orgId);
  const candidateLimit = mmrEnabled
    ? Number(process.env.MEMORY_MMR_CANDIDATES ?? 40)
    : 25;
  // Default 0.65 == 1 − 0.35 (the old SQL floor), so out-of-the-box injected set
  // is identical to legacy even when full-pool mode is on.
  const injectionFloor = Number(process.env.MEMORY_P1B_FLOOR ?? 0.65);

  if (!taskContext) return [];

  try {
    const vec = await embedQuery(taskContext);
    if (!vec) return [];

    const vecLiteral  = `[${vec.join(',')}]`;
    const typeList    = ruleTypes.map((t) => `'${t}'`).join(', ');
    const excludeList = excludeIds.length > 0 ? excludeIds : ['__no_match__'];

    const embeddingSelect = mmrEnabled ? `,\n             embedding::text AS embedding_txt` : '';

    // Full-pool path: loose sanity cut only (< 0.8) — MMR sees all viable candidates.
    // Legacy path: hard floor (< 0.35) in SQL, same as before.
    const distanceFilter = fullPoolEnabled
      ? `AND (embedding <=> '${vecLiteral}'::vector) < 0.8`
      : `AND (embedding <=> '${vecLiteral}'::vector) < 0.35`;

    const rows = await prisma.$queryRawUnsafe<CosineSimilarityRow[]>(`
      SELECT id, rule_text, rule_type,
             confidence::float AS confidence,
             helpful_count, harmful_count,
             (embedding <=> '${vecLiteral}'::vector) AS distance${embeddingSelect}
      FROM platform_agent_memory
      WHERE
        org_id      = $1
        AND agent_class = $2
        AND status      = 'ACTIVE'
        AND embedding   IS NOT NULL
        AND rule_type   IN (${typeList})
        AND id          != ALL($3::text[])
        ${visibilityClause(4)}
        ${distanceFilter}
      ORDER BY embedding <=> '${vecLiteral}'::vector ASC
      LIMIT ${candidateLimit}
    `, orgId, agentClass, excludeList, callerUserId);

    if (mmrEnabled && rows.length > 0) {
      const candidates: DiversityCandidate[] = rows
        .filter((r) => r.embedding_txt)
        .map((r) => ({
          id: r.id,
          embedding: parsePgVector(r.embedding_txt!),
          relevance: 1 - Number(r.distance),
          tokens: estimateTokens(r.rule_text),
        }));

      const lambda = Number(process.env.MEMORY_MMR_LAMBDA ?? 0.7);
      const selected = mmrSelect(candidates, { lambda, k: 20, budgetTokens: budget });

      // Injection-time relevance floor (full-pool path only).
      // Drops post-MMR bullets that are below the relevance threshold so we never
      // inject junk that was only pulled in because SQL distance was relaxed.
      const injected = fullPoolEnabled
        ? selected.filter((s) => s.relevance >= injectionFloor)
        : selected;

      const rowMap = new Map(rows.map((r) => [r.id, r]));

      return injected
        .map((s) => rowMap.get(s.id)!)
        .map((row) => ({
          id:           row.id,
          ruleText:     row.rule_text,
          ruleType:     row.rule_type,
          confidence:   parseConfidence(row.confidence),
          helpfulCount: Number(row.helpful_count),
          harmfulCount: Number(row.harmful_count),
        }));
    }

    // Flag-off path (MEMORY_MMR_ENABLED=false): existing greedy budget-pack.
    const result: MemoryBullet[] = [];
    let used = 0;
    for (const row of rows) {
      const tokens = estimateTokens(row.rule_text);
      if (used + tokens > budget) break;
      result.push({
        id:           row.id,
        ruleText:     row.rule_text,
        ruleType:     row.rule_type,
        confidence:   parseConfidence(row.confidence),
        helpfulCount: Number(row.helpful_count),
        harmfulCount: Number(row.harmful_count),
      });
      used += tokens;
    }
    return result;
  } catch (err) {
    console.warn('[memory/retrieve] Phase 1b query failed (non-fatal):', err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SelectMemoryResult {
  phase0:  MemoryBullet[];
  phase1a: MemoryBullet[];
  phase1b: MemoryBullet[];
}

/**
 * Run all three phases and return bullets grouped by phase.
 *
 * All phases are non-fatal — each returns [] on error.
 * lastUsedAt is bumped for all returned bullets in a fire-and-forget update.
 *
 * @param topicKey  The topicKey from PlatformMemoryTopic for the current task.
 *                  Scopes Phase 1a to the correct data domain. Pass null when unknown.
 */
export async function selectMemoryAll(
  orgId:        string,
  agentClass:   string,
  taskContext:  string,
  topicKey:     string | null = null,
  callerUserId: string | null = null,
): Promise<SelectMemoryResult> {
  // Phase 3.5D — resolve to the sentinel when no caller is known, so retrieval
  // returns org-visible rules only and never leaks a personal rule.
  const caller = callerUserId ?? NO_USER_SENTINEL;
  const [phase0, phase1a] = await Promise.all([
    selectPhase0(orgId, agentClass, caller),
    selectPhase1a(orgId, agentClass, topicKey, caller),
  ]);

  const excludeIds = [...phase0, ...phase1a].map((b) => b.id);
  const phase1b    = await selectPhase1b(orgId, agentClass, taskContext, excludeIds, caller);

  // Fire-and-forget lastUsedAt bump.
  const allIds = [...excludeIds, ...phase1b.map((b) => b.id)];
  if (allIds.length > 0) {
    prisma.platformAgentMemory
      .updateMany({ where: { id: { in: allIds } }, data: { lastUsedAt: new Date() } })
      .catch((e: unknown) => {
        console.warn('[memory/retrieve] lastUsedAt bump failed:', e instanceof Error ? e.message : String(e));
      });
  }

  return { phase0, phase1a, phase1b };
}

/**
 * Legacy single-phase selectMemory for callers that haven't migrated.
 * Falls back to Phase 1a + Phase 1b merged into one flat array.
 */
export async function selectMemory(
  orgId:        string,
  agentClass:   string,
  taskContext:  string,
  phase:        MemoryPhase | null = null,
  topicKey:     string | null = null,
  budgetTokens: number = DEFAULT_BUDGET_TOKENS,
): Promise<MemoryBullet[]> {
  if (phase === MemoryPhase.INIT)          return selectPhase0(orgId, agentClass);
  if (phase === MemoryPhase.SCHEMA_GLOBAL) return selectPhase1a(orgId, agentClass, topicKey);
  if (phase === MemoryPhase.TASK_SCOPED)   return selectPhase1b(orgId, agentClass, taskContext, []);

  // No phase: return everything merged, budget-capped.
  const { phase0, phase1a, phase1b } = await selectMemoryAll(orgId, agentClass, taskContext, topicKey);
  const merged = [...phase0, ...phase1a, ...phase1b];

  // Token-cap the merged result to the requested budget.
  const capped: MemoryBullet[] = [];
  let used = 0;
  for (const b of merged) {
    const t = estimateTokens(b.ruleText);
    if (used + t > budgetTokens) break;
    capped.push(b);
    used += t;
  }
  return capped;
}

// ── Formatter ─────────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<MemoryPhase, string> = {
  [MemoryPhase.INIT]:          'phase:init',
  [MemoryPhase.SCHEMA_GLOBAL]: 'phase:schema-global',
  [MemoryPhase.TASK_SCOPED]:   'phase:task-scoped',
};

/**
 * Format retrieved bullets as a compact system-prompt block.
 *
 * Returns empty string when bullets is empty.
 */
export function formatForInjection(bullets: MemoryBullet[], phase?: MemoryPhase): string {
  if (bullets.length === 0) return '';

  const lines = bullets.map((b) => `- [${b.ruleType}] ${b.ruleText}`);

  const phaseComment = phase !== undefined ? ` | ${PHASE_LABEL[phase]}` : '';

  return [
    `=== OPERATING MEMORY${phaseComment} ===`,
    ...lines,
    '=== END OPERATING MEMORY ===',
  ].join('\n');
}

// Re-export for callers that import from retrieve.ts.
export { MemoryPhase } from './phases';
