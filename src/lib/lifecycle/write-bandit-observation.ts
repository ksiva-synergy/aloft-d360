/**
 * write-bandit-observation.ts
 * Fire-and-forget helper that persists a run's raw artifacts and initial
 * C + T scores into `bandit_observations`.
 *
 * S + G are left null at write time — they are filled post-hoc by judge-batch.ts.
 * V is optional and only set when a golden rule eval suite is configured.
 */

import { prisma } from '@/lib/db';
import { scoreCtsgv, hardenedToolScore } from '@/lib/lifecycle/score-ctsgv';

export type BanditObservationInput = {
  source: 'inspector' | 'workbench' | 'boost';
  /** session_id or platform_boost_runs.id — used for dedup (unique constraint). */
  sourceRunId: string;
  modelId: string;
  provider: string;
  /** 'inspector_chat' | 'workbench_<artifactType>' | 'boost_<caseId>' */
  sheetType: string;

  /** Full answer text from the model — needed by the AI judge. */
  answerFull: string | null;
  /** Serialised tool call trajectory — needed by the AI judge for groundedness. */
  toolTrajectory: unknown[];

  inputTokens: number;
  outputTokens: number;
  toolCallsTotal: number;
  toolCallsError: number;
  toolCallsDiscovery: number;
  durationMs: number;
  outcome: 'completed' | 'truncated' | 'errored';

  /**
   * Pre-scored S / G values — only set for boost runs that were already judged
   * via score-and-report.ts before being backfilled.
   */
  scoreS?: number | null;
  scoreG?: number | null;
  /** Groundedness mode used — needed to guide the judge if re-scoring is required. */
  groundednessMode?: 'phantom_trace' | 'consistency_check';
  /** Context mode — determines truncation penalty severity. */
  contextMode?: 'harvested' | 'warehouse_only';
};

/**
 * Write a single bandit observation. Skips silently on duplicate source_run_id
 * (ON CONFLICT DO NOTHING equivalent — Prisma will throw on unique violation and
 * we swallow it as a no-op).
 *
 * Never throws — always fire-and-forget safe.
 */
export async function writeBanditObservation(input: BanditObservationInput): Promise<string | null> {
  try {
    const scoreS = input.scoreS ?? null;
    const scoreG = input.scoreG ?? null;

    // Compute C + T immediately; include S + G if already available (boost backfill)
    const { composite, success, breakdown } = scoreCtsgv({
      c: { inputTokens: input.inputTokens, outputTokens: input.outputTokens },
      t: { total: input.toolCallsTotal, errors: input.toolCallsError, discovery: input.toolCallsDiscovery },
      s: scoreS,
      g: scoreG,
      v: null,
      outcome: input.outcome,
      sheetType: input.sheetType,
      contextMode: input.contextMode ?? null,
    });

    // Hardened T score — matches what scoreCtsgv computes internally
    const hardenedT = hardenedToolScore({
      sheetType: input.sheetType,
      total: input.toolCallsTotal,
      error: input.toolCallsError,
      discovery: input.toolCallsDiscovery,
    });

    const row = await prisma.bandit_observations.create({
      data: {
        source:               input.source,
        source_run_id:        input.sourceRunId,
        model_id:             input.modelId,
        provider:             input.provider,
        sheet_type:           input.sheetType,
        answer_full:          input.answerFull,
        tool_trajectory:      input.toolTrajectory as object[],
        score_c:              breakdown.c,
        score_t:              hardenedT,
        score_s:              scoreS,
        score_g:              scoreG,
        score_v:              null,
        composite_score:      composite,
        success,
        input_tokens:         input.inputTokens,
        output_tokens:        input.outputTokens,
        tool_calls_total:     input.toolCallsTotal,
        tool_calls_error:     input.toolCallsError,
        tool_calls_discovery: input.toolCallsDiscovery,
        duration_ms:          Math.round(input.durationMs),
        outcome:              input.outcome,
        groundedness_mode:    input.groundednessMode ?? null,
        // scored_at is set only when judge fills S + G
        scored_at: (scoreS !== null && scoreG !== null) ? new Date() : null,
      },
      select: { id: true },
    });

    return row.id;
  } catch (err: unknown) {
    // Swallow unique constraint violations (duplicate source_run_id) silently
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Unique constraint') || msg.includes('unique')) {
      return null;
    }
    console.error('[lifecycle/write-bandit-observation] insert failed:', msg);
    return null;
  }
}
