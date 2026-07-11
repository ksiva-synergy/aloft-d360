/**
 * score-ctsgv.ts
 * Multi-dimensional CTSGV reward function for the Thompson Sampling bandit.
 *
 * Dimensions:
 *   C — Cost      : token burn efficiency (available at run time)
 *   T — Tool      : tool call efficiency — error rate + discovery overhead (available at run time)
 *   S — Semantic  : LLM-as-judge semantic quality 0-1 (filled post-hoc by judge-batch)
 *   G — Grounds   : LLM-as-judge groundedness 0-1 (filled post-hoc by judge-batch)
 *   V — Verify    : golden rule / structured eval pass (filled when eval suite configured)
 *
 * BORN Phase 1 (D-9) hardening:
 *   - Pending dims (S, G) contribute 0 at full weight (pessimistic until judged).
 *   - NA dims (V) are redistributed out of the denominator.
 *   - COPOUT_FLOOR penalises zero-tool-call answers on data tasks.
 *   - G_FLOOR gates success — unjudged or poorly grounded runs cannot be a bandit success.
 *
 * Outcome gate: graduated caps — context harness truncated→0.18, SQL-only truncated→0.35, errored→0.10.
 */

export type CtsgvDimensions = {
  /** Cost efficiency input: raw token counts. */
  c: { inputTokens: number; outputTokens: number };
  /** Tool efficiency input: raw call counts. */
  t: { total: number; errors: number; discovery: number };
  /** Semantic quality from AI judge (0-1), or null if not yet scored. */
  s: number | null;
  /** Groundedness from AI judge (0-1), or null if not yet scored. */
  g: number | null;
  /** Golden rule / structured eval pass (true/false), or null if no eval suite. */
  v: boolean | null;
  /** Outcome of the run — gates the composite via an upper cap for non-completed runs. */
  outcome: 'completed' | 'truncated' | 'errored' | string;
  /** Sheet type — used by hardened T logic to detect copout non-answers. */
  sheetType?: string;
  /** Context mode — SQL-only truncation is expected (lighter penalty); context harness truncation is heavy. */
  contextMode?: 'harvested' | 'warehouse_only' | null;
};

export type CtsgvResult = {
  /** Weighted composite score (0-1). */
  composite: number;
  /** true when composite >= SUCCESS_THRESHOLD (0.5). */
  success: boolean;
  /** Per-dimension 0-1 scores (null when dimension unavailable). */
  breakdown: {
    c: number;
    t: number;
    s: number | null;
    g: number | null;
    v: number | null;
  };
  /** Which dimensions contributed to this composite. */
  availableDimensions: ('c' | 't' | 's' | 'g' | 'v')[];
};

// ── BORN Phase 1 tunable constants ──────────────────────────────────────────
export const COPOUT_FLOOR = 0.10;
export const G_FLOOR = 0.30;
export const PENDING_DIMS: ('s' | 'g')[] = ['s', 'g'];
export const NA_DIMS: ('v')[] = ['v'];
export const BASE_WEIGHTS = {
  c: 0.20,
  t: 0.15,
  s: 0.25,
  g: 0.30,
  v: 0.10,
} as const;
export const OUTCOME_CAPS_CTX: Record<string, number> = {
  completed: 1.00,
  truncated: 0.18,
  errored:   0.10,
};
export const OUTCOME_CAPS_SQL: Record<string, number> = {
  completed: 1.00,
  truncated: 0.35,
  errored:   0.10,
};

const SUCCESS_THRESHOLD = 0.5;

/**
 * Sheet types that intrinsically require tool calls (lakehouse queries).
 * Everything matches today — the denylist is for future pure-reasoning tasks.
 */
const TOOL_EXPECTED_PATTERN = /^(boost_|inspector_chat|workbench_)/;
const NO_TOOL_SHEETS: string[] = [];

/**
 * Token cost penalty: logistic curve — no penalty below LOW_TOKENS,
 * score reaches ~0.12 at HIGH_TOKENS.
 */
const LOW_TOKENS  = 30_000;
const HIGH_TOKENS = 150_000;

function scoreCostDimension(inputTokens: number, outputTokens: number): number {
  const total = inputTokens + outputTokens;
  if (total <= LOW_TOKENS) return 1.0;
  const midpoint = (LOW_TOKENS + HIGH_TOKENS) / 2;
  const k = 8 / (HIGH_TOKENS - LOW_TOKENS);
  return 1 / (1 + Math.exp(k * (total - midpoint)));
}

// ── Hardened Tool Score (exported) ──────────────────────────────────────────

export function expectsTools(sheetType: string): boolean {
  if (NO_TOOL_SHEETS.includes(sheetType)) return false;
  return TOOL_EXPECTED_PATTERN.test(sheetType);
}

export function hardenedToolScore(params: {
  sheetType: string;
  total: number;
  error: number;
  discovery: number;
}): number {
  const { sheetType, total, error, discovery } = params;
  const tool_success = total === 0 ? 1.0 : Math.max(0, 1 - error / total);
  const discovery_penalty = Math.max(0, 1 - discovery / 5);
  const base = (tool_success + discovery_penalty) / 2;

  if (expectsTools(sheetType)) {
    const errorRate = total > 0 ? error / total : 0;
    if (total === 0) return COPOUT_FLOOR;
    if (total <= 2) return Math.max(COPOUT_FLOOR, base * 0.25 * (1 - errorRate));
    if (total <= 4) return Math.max(COPOUT_FLOOR, base * 0.55 * (1 - errorRate));
    return base;
  }

  return base;
}

/**
 * Compute the CTSGV composite score with BORN Phase 1 hardening:
 *   - NA dims (V when null) → redistributed out of denominator
 *   - PENDING dims (S, G when null) → contribute 0 but keep full weight in denominator
 */
export function scoreCtsgv(dims: CtsgvDimensions): CtsgvResult {
  const scoreC = scoreCostDimension(dims.c.inputTokens, dims.c.outputTokens);
  const scoreT = dims.sheetType
    ? hardenedToolScore({ sheetType: dims.sheetType, total: dims.t.total, error: dims.t.errors, discovery: dims.t.discovery })
    : hardenedToolScore({ sheetType: 'inspector_chat', total: dims.t.total, error: dims.t.errors, discovery: dims.t.discovery });
  const scoreS = typeof dims.s === 'number' ? Math.max(0, Math.min(1, dims.s)) : null;
  const scoreG = typeof dims.g === 'number' ? Math.max(0, Math.min(1, dims.g)) : null;
  const scoreV = dims.v === null ? null : dims.v ? 1.0 : 0.0;

  const dimensionScores = { c: scoreC, t: scoreT, s: scoreS, g: scoreG, v: scoreV };

  let denominator = 0;
  let numerator = 0;
  const available: ('c' | 't' | 's' | 'g' | 'v')[] = [];

  for (const dim of ['c', 't', 's', 'g', 'v'] as const) {
    const val = dimensionScores[dim];
    if (val === null && (NA_DIMS as string[]).includes(dim)) {
      continue;
    }
    available.push(dim);
    const w = BASE_WEIGHTS[dim];
    denominator += w;
    numerator += w * (val ?? 0);
  }

  let composite = denominator > 0 ? numerator / denominator : 0;

  const caps = dims.contextMode === 'harvested' ? OUTCOME_CAPS_CTX : OUTCOME_CAPS_SQL;
  const cap = caps[dims.outcome] ?? 0.15;
  composite = Math.min(composite, cap);

  composite = Math.round(composite * 1000) / 1000;

  const judged = scoreG !== null;
  const success = composite >= SUCCESS_THRESHOLD && judged && scoreG >= G_FLOOR;

  return {
    composite,
    success,
    breakdown: { c: scoreC, t: scoreT, s: scoreS, g: scoreG, v: scoreV },
    availableDimensions: available,
  };
}

/**
 * Convenience: recompute composite for a partially-scored bandit_observations row,
 * returning only composite + success (suitable for an UPDATE call).
 */
export function recomputeCtsgv(row: {
  input_tokens: number;
  output_tokens: number;
  tool_calls_total: number;
  tool_calls_error: number;
  tool_calls_discovery: number;
  score_s: number | null;
  score_g: number | null;
  score_v: number | null;
  outcome: string | null;
  sheet_type?: string;
  context_mode?: string | null;
}): { composite: number; success: boolean; breakdown: { c: number; t: number; s: number | null; g: number | null; v: number | null } } {
  const result = scoreCtsgv({
    c: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
    t: { total: row.tool_calls_total, errors: row.tool_calls_error, discovery: row.tool_calls_discovery },
    s: row.score_s,
    g: row.score_g,
    v: row.score_v === null ? null : row.score_v >= 0.5,
    outcome: row.outcome ?? 'errored',
    sheetType: row.sheet_type,
    contextMode: (row.context_mode as 'harvested' | 'warehouse_only') ?? null,
  });
  return { composite: result.composite, success: result.success, breakdown: result.breakdown };
}
