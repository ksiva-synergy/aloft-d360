/**
 * AM2.1 — Memory injection phase configuration.
 *
 * Three phases split the memory injection budget across targeted moments in the
 * conversation lifecycle:
 *
 *   Phase 0 (INIT — system prompt, before any user message):
 *     HARD_RULEs only, restricted to rules with confirmed real failures
 *     (confidence >= 0.9 AND harmful_count >= 1). Budget: 200 tokens, max 3 bullets.
 *     These are non-negotiable guardrails that prevent the agent from repeating
 *     catastrophic mistakes — e.g. querying non-existent paths, malformed args.
 *
 *   Phase 1a (SCHEMA_GLOBAL — system prompt, appended after Phase 0):
 *     SCHEMA_MAPs scoped to the agent class + inferred topic group (e.g.
 *     "Estate Navigation", "Crew & Personnel"). Shelf-level: typically 3-5
 *     schema bullets per topic, max 10. Gives the agent the structural schema
 *     map of the data domain it is about to operate in.
 *     Budget: 600 tokens, max 10 bullets.
 *
 *   Phase 1b (TASK_SCOPED — synthetic assistant recall turn before first user msg):
 *     HEURISTIC / SOURCE_PREF / FAILURE_MODE bullets retrieved via cosine search
 *     against the specific task context. Task-specific: 12-20 contextual rules
 *     drawn from prior runs of this exact task type.
 *     Budget: 1200 tokens, max 20 bullets.
 *
 * Total effective budget: 200 + 600 + 1200 = 2000 tokens across all phases.
 *
 * Individual phase budgets are tunable via environment variables:
 *   MEMORY_PHASE1A_BUDGET  (default: 600)
 *   MEMORY_PHASE1B_BUDGET  (default: 1200)
 */

export enum MemoryPhase {
  /** Fatal guardrails — HARD_RULEs with confirmed real failures only. System prompt. */
  INIT          = 0,
  /** Topic-group SCHEMA_MAPs for the agent's data domain. System prompt. */
  SCHEMA_GLOBAL = 1,
  /** Task-scoped HEURISTIC/SOURCE_PREF/FAILURE_MODE via cosine search. Recall turn. */
  TASK_SCOPED   = 2,
}

function envBudget(envVar: string, fallback: number): number {
  const v = process.env[envVar];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-phase token budgets (server-side, reads env vars at call time). */
export function getPhaseBudget(phase: MemoryPhase): number {
  switch (phase) {
    case MemoryPhase.INIT:          return 200;
    case MemoryPhase.SCHEMA_GLOBAL: return envBudget('MEMORY_PHASE1A_BUDGET', 600);
    case MemoryPhase.TASK_SCOPED:   return envBudget('MEMORY_PHASE1B_BUDGET', 1200);
  }
}

/** Static fallbacks for client-side UI (cannot read env vars). */
export const PHASE_BUDGETS_DEFAULT: Record<MemoryPhase, number> = {
  [MemoryPhase.INIT]:          200,
  [MemoryPhase.SCHEMA_GLOBAL]: 600,
  [MemoryPhase.TASK_SCOPED]:   1200,
};

/** Rule types eligible for each phase. */
export const PHASE_RULE_TYPES: Record<MemoryPhase, string[]> = {
  [MemoryPhase.INIT]:          ['HARD_RULE'],
  [MemoryPhase.SCHEMA_GLOBAL]: ['SCHEMA_MAP'],
  [MemoryPhase.TASK_SCOPED]:   ['HEURISTIC', 'SOURCE_PREF', 'FAILURE_MODE'],
};

/** Hard cap on bullets pulled from the DB per phase. */
export const PHASE_TIER1_CAP: Record<MemoryPhase, number> = {
  [MemoryPhase.INIT]:          3,
  [MemoryPhase.SCHEMA_GLOBAL]: 10,
  [MemoryPhase.TASK_SCOPED]:   20,
};

/** Phase 0 minimum confidence + must have at least 1 real harmful hit. */
export const PHASE0_CONFIDENCE_FLOOR = 0.9;
export const PHASE0_MIN_HARMFUL      = 1;

/** Total cross-phase budget for UI display (uses static defaults). */
export const TOTAL_BUDGET_TOKENS =
  PHASE_BUDGETS_DEFAULT[MemoryPhase.INIT] +
  PHASE_BUDGETS_DEFAULT[MemoryPhase.SCHEMA_GLOBAL] +
  PHASE_BUDGETS_DEFAULT[MemoryPhase.TASK_SCOPED];
