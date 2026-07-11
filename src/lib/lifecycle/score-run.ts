/**
 * score-run.ts
 * Computes a 0.0–1.0 quality score for a single inspector or workbench chat run.
 * The score feeds the `quality_score` field in `backfill_model_stats` and
 * determines the binary `success` reward used by the Thompson Sampling bandit.
 */

export interface RunScoreInput {
  /** Did the stream finish cleanly with a `done` event (not an error/abort)? */
  completed: boolean;
  /** Number of tool calls that resolved with status 'success'. */
  toolCallSuccessCount: number;
  /** Number of tool calls that resolved with status 'error'. */
  toolCallErrorCount: number;
  /** Whether a hard control-boundary violation occurred (DML/DDL attempt). */
  hasControlBoundaryViolation: boolean;
  /** Whether any retryable errors occurred (e.g. result too large). */
  hasRetryableErrors: boolean;
  /** How many agentic loops were consumed this turn. */
  loopsUsed: number;
  /** Maximum allowed loops (usually 8). */
  maxLoops: number;
  /** Total tokens used this turn (input + output combined). */
  totalTokens: number;
}

export interface RunScoreResult {
  qualityScore: number;
  success: boolean;
  breakdown: {
    completion: number;
    toolSuccess: number;
    satisfaction: number;
    efficiency: number;
    tokenEconomy: number;
  };
}

const WEIGHTS = {
  completion: 0.30,
  toolSuccess: 0.30,
  satisfaction: 0.20,
  efficiency: 0.10,
  tokenEconomy: 0.10,
};

/** Token threshold above which the economy component starts penalizing. */
const TOKEN_PENALTY_THRESHOLD = 50_000;
/** Tokens at which the economy score reaches ~0.1 (effectively maxed out penalty). */
const TOKEN_PENALTY_MAX = 200_000;

/**
 * Logistic sigmoid scaled so that:
 *   x = TOKEN_PENALTY_THRESHOLD → score ≈ 0.88
 *   x = TOKEN_PENALTY_MAX       → score ≈ 0.12
 */
function tokenEconomyScore(totalTokens: number): number {
  if (totalTokens <= TOKEN_PENALTY_THRESHOLD) return 1.0;
  const midpoint = (TOKEN_PENALTY_THRESHOLD + TOKEN_PENALTY_MAX) / 2;
  const k = 8 / (TOKEN_PENALTY_MAX - TOKEN_PENALTY_THRESHOLD);
  return 1 / (1 + Math.exp(k * (totalTokens - midpoint)));
}

export function scoreRun(input: RunScoreInput): RunScoreResult {
  // Component 1 — Completion
  const completion = input.completed ? 1.0 : 0.0;

  // Component 2 — Tool call success rate
  const totalToolCalls = input.toolCallSuccessCount + input.toolCallErrorCount;
  const toolSuccess = totalToolCalls === 0
    ? 1.0 // no tool calls attempted: neutral, not penalized
    : input.toolCallSuccessCount / totalToolCalls;

  // Component 3 — User satisfaction proxy
  let satisfaction: number;
  if (input.hasControlBoundaryViolation) {
    satisfaction = 0.0;
  } else if (input.hasRetryableErrors) {
    satisfaction = 0.5;
  } else {
    satisfaction = 1.0;
  }

  // Component 4 — Loop efficiency (fewer loops consumed = better)
  const efficiency = input.maxLoops > 0
    ? 1 - (input.loopsUsed / input.maxLoops)
    : 0.0;

  // Component 5 — Token economy
  const tokenEconomy = tokenEconomyScore(input.totalTokens);

  const breakdown = { completion, toolSuccess, satisfaction, efficiency, tokenEconomy };

  const qualityScore = Math.round((
    completion   * WEIGHTS.completion   +
    toolSuccess  * WEIGHTS.toolSuccess  +
    satisfaction * WEIGHTS.satisfaction +
    efficiency   * WEIGHTS.efficiency   +
    tokenEconomy * WEIGHTS.tokenEconomy
  ) * 1000) / 1000;

  // Binary success threshold: score >= 0.5
  const success = qualityScore >= 0.5;

  return { qualityScore, success, breakdown };
}
