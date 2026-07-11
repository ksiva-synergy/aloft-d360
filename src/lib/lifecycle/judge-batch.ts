/**
 * judge-batch.ts
 * AI-as-judge for bandit observations: fills score_s (Semantic) and score_g
 * (Groundedness) for observations that only have C + T scores so far.
 *
 * Two modes share the same core logic:
 *   - scoreSingleObservation(id): async, fire-and-forget immediately after a run
 *   - scoreBatch(limit): cron fallback — processes up to `limit` unscored rows
 *
 * For boost observations (source = 'boost'), groundedness uses 'phantom_trace' mode
 * when groundedness_mode = 'phantom_trace', otherwise 'consistency_check'.
 * For all interactive runs (inspector / workbench), 'consistency_check' is used.
 */

import { prisma } from '@/lib/db';
import { scoreGroundedness } from '@/lib/boost/scorers/groundedness';
import { scoreSemanticQuality } from '@/lib/boost/scorers/semantic';
import { recomputeCtsgv } from '@/lib/lifecycle/score-ctsgv';
import type { BoostCase } from '@/lib/boost/suite';
import { BOOST_SUITE_V1, BOOST_SUITE_V2 } from '@/lib/boost/suite';

const JUDGE_MODEL = 'us.anthropic.claude-sonnet-4-6';

const ALL_BOOST_CASES: BoostCase[] = [...BOOST_SUITE_V1, ...BOOST_SUITE_V2];

/** Resolve the BoostCase for a boost observation (needed for semantic scorer). */
function resolveBoostCase(sheetType: string): BoostCase | null {
  // sheetType format: 'boost_<case_id>'
  if (!sheetType.startsWith('boost_')) return null;
  const caseId = sheetType.slice('boost_'.length);
  return ALL_BOOST_CASES.find(c => c.id === caseId) ?? null;
}

/**
 * Build a synthetic BoostCase-like object for interactive runs that lack one.
 * The semantic scorer needs expectedDimensions — we pass a generic list so it
 * evaluates completeness relative to a general data analysis task.
 */
function buildInteractiveCase(sheetType: string): BoostCase {
  return {
    id: sheetType,
    title: 'Interactive data analysis',
    prompt: '(interactive session)',
    sourceTable: '',
    taskType: 'advisory',
    groundednessMode: 'consistency_check',
    expectedDimensions: [
      'question answered',
      'data referenced',
      'analysis depth',
      'actionable insights',
    ],
  };
}

async function judgeObservation(obs: {
  id: string;
  source: string;
  sheet_type: string;
  answer_full: string | null;
  tool_trajectory: unknown;
  groundedness_mode: string | null;
  input_tokens: number;
  output_tokens: number;
  tool_calls_total: number;
  tool_calls_error: number;
  tool_calls_discovery: number;
  score_v: number | null;
  outcome: string | null;
}): Promise<void> {
  const answerFull = obs.answer_full;
  if (!answerFull || answerFull.trim().length === 0) return;

  const trajectory = Array.isArray(obs.tool_trajectory) ? obs.tool_trajectory : [];

  // Determine scoring mode
  const gMode = (obs.groundedness_mode as 'phantom_trace' | 'consistency_check' | null)
    ?? (obs.source === 'boost' ? 'phantom_trace' : 'consistency_check');

  // Resolve boost case (for semantic scorer) or build a synthetic one
  const boostCase: BoostCase =
    resolveBoostCase(obs.sheet_type) ?? buildInteractiveCase(obs.sheet_type);

  // Run S and G scorers concurrently
  const [semResult, groundResult] = await Promise.all([
    scoreSemanticQuality({ answerFull, answerExcerpt: null, boostCase, toolTrajectory: trajectory }),
    scoreGroundedness({ answerFull, answerExcerpt: null, toolTrajectory: trajectory, mode: gMode }),
  ]);

  const scoreS = semResult?.composite ?? null;
  const scoreG = groundResult?.score ?? null;

  // Recompute composite with the new S + G values
  const { composite, success } = recomputeCtsgv({
    input_tokens:         obs.input_tokens,
    output_tokens:        obs.output_tokens,
    tool_calls_total:     obs.tool_calls_total,
    tool_calls_error:     obs.tool_calls_error,
    tool_calls_discovery: obs.tool_calls_discovery,
    score_s:              scoreS,
    score_g:              scoreG,
    score_v:              obs.score_v,
    outcome:              obs.outcome,
  });

  await prisma.bandit_observations.update({
    where: { id: obs.id },
    data: {
      score_s:         scoreS,
      score_g:         scoreG,
      composite_score: composite,
      success,
      scored_at:       new Date(),
      judge_model:     JUDGE_MODEL,
    },
  });
}

/**
 * Score a single observation by ID.
 * Used immediately after a run (fire-and-forget mode).
 * Never throws.
 */
export async function scoreSingleObservation(id: string): Promise<void> {
  try {
    const obs = await prisma.bandit_observations.findUnique({
      where: { id },
      select: {
        id: true, source: true, sheet_type: true,
        answer_full: true, tool_trajectory: true, groundedness_mode: true,
        input_tokens: true, output_tokens: true,
        tool_calls_total: true, tool_calls_error: true, tool_calls_discovery: true,
        score_v: true, outcome: true,
      },
    });
    if (!obs) return;
    await judgeObservation(obs);
  } catch (err) {
    console.error('[judge-batch/single] scoring failed for', id, err instanceof Error ? err.message : err);
  }
}

export type BatchJudgeResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

/**
 * Score a batch of unscored observations.
 * Used by the cron fallback route. Picks rows older than `minAgeSeconds` (default 60s)
 * to give the async single-observation scorer a chance to run first.
 *
 * Never throws — always returns a result summary.
 */
export async function scoreBatch(options: {
  limit?: number;
  minAgeSeconds?: number;
} = {}): Promise<BatchJudgeResult> {
  const limit        = options.limit ?? 20;
  const minAgeMs     = (options.minAgeSeconds ?? 60) * 1000;
  const cutoffDate   = new Date(Date.now() - minAgeMs);

  const result: BatchJudgeResult = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

  let rows: Array<{
    id: string; source: string; sheet_type: string;
    answer_full: string | null; tool_trajectory: unknown; groundedness_mode: string | null;
    input_tokens: number; output_tokens: number;
    tool_calls_total: number; tool_calls_error: number; tool_calls_discovery: number;
    score_v: number | null; outcome: string | null;
  }>;

  try {
    rows = await prisma.bandit_observations.findMany({
      where: {
        scored_at: null,
        created_at: { lt: cutoffDate },
        answer_full: { not: null },
      },
      orderBy: { created_at: 'asc' },
      take: limit,
      select: {
        id: true, source: true, sheet_type: true,
        answer_full: true, tool_trajectory: true, groundedness_mode: true,
        input_tokens: true, output_tokens: true,
        tool_calls_total: true, tool_calls_error: true, tool_calls_discovery: true,
        score_v: true, outcome: true,
      },
    });
  } catch (err) {
    console.error('[judge-batch/batch] query failed:', err instanceof Error ? err.message : err);
    return result;
  }

  for (const obs of rows) {
    result.processed++;
    if (!obs.answer_full || obs.answer_full.trim().length === 0) {
      result.skipped++;
      continue;
    }
    try {
      await judgeObservation(obs);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      console.error('[judge-batch/batch] failed for', obs.id, err instanceof Error ? err.message : err);
    }
  }

  return result;
}
