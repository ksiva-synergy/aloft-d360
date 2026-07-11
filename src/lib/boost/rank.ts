import type { ToolKind } from './classify';

export const OUTCOME_RANK = { completed: 2, errored: 1, truncated: 0 } as const;

export const BOOST_SCORE_VERSION = 'boost_score_v1';

export function deriveCounts(trajectory: { kind: ToolKind }[]): {
  total: number;
  catalog: number;
  data: number;
  discovery: number;
  error: number;
} {
  const counts = { total: 0, catalog: 0, data: 0, discovery: 0, error: 0 };
  for (const step of trajectory) {
    counts.total++;
    counts[step.kind]++;
  }
  return counts;
}

/**
 * Efficiency score for completed runs.
 * Formula: 1000 / (1 + discovery_calls + (total_tokens / 10000))
 *
 * Higher is better. Penalises discovery calls (blind exploration) and token burn.
 * Only meaningful for completed runs.
 */
export function efficiencyScore(run: {
  tool_calls_discovery: number;
  input_tokens: number;
  output_tokens: number;
}): number {
  const totalTokens = run.input_tokens + run.output_tokens;
  return 1000 / (1 + run.tool_calls_discovery + totalTokens / 10000);
}

/**
 * Lexicographic comparator for boost runs. Total order.
 *
 * Sort priority (descending = better first):
 *   1. outcome rank DESC (completed > errored > truncated)
 *   2. groundedness DESC (null last)
 *   3. efficiency score DESC
 *   4. semantic_score DESC (null last)
 */
export function compareBoostRuns(
  a: {
    outcome: string;
    groundedness: number | null;
    tool_calls_discovery: number;
    input_tokens: number;
    output_tokens: number;
    semantic_score: number | null;
  },
  b: {
    outcome: string;
    groundedness: number | null;
    tool_calls_discovery: number;
    input_tokens: number;
    output_tokens: number;
    semantic_score: number | null;
  },
): number {
  const rankA = OUTCOME_RANK[a.outcome as keyof typeof OUTCOME_RANK] ?? -1;
  const rankB = OUTCOME_RANK[b.outcome as keyof typeof OUTCOME_RANK] ?? -1;
  if (rankB !== rankA) return rankB - rankA;

  const gA = a.groundedness ?? -Infinity;
  const gB = b.groundedness ?? -Infinity;
  if (gB !== gA) return gB - gA;

  const eA = efficiencyScore(a);
  const eB = efficiencyScore(b);
  if (eB !== eA) return eB - eA;

  const sA = a.semantic_score ?? -Infinity;
  const sB = b.semantic_score ?? -Infinity;
  return sB - sA;
}
