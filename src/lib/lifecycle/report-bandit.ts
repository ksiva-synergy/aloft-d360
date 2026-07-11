/**
 * report-bandit.ts
 * Writes a completed inspector or workbench chat run into `backfill_model_stats`
 * so the Thompson Sampling bandit can learn from it.
 *
 * The `sheet_type` column is repurposed as a surface/task label:
 *   - inspector runs:  'inspector_chat'
 *   - workbench runs:  'workbench_<artifactType>'  (e.g. 'workbench_agent')
 *
 * The `source` column is set to 'inspector' or 'workbench' — both are recognised
 * by the bandit API route and dashboard via the RunSource type.
 */

import { prisma } from '@/lib/db';

export type BanditReportSource = 'inspector' | 'workbench' | 'boost';

export interface BanditReport {
  source: BanditReportSource;
  /** Bedrock model ID as used in the chat route (e.g. 'us.anthropic.claude-sonnet-4-6'). */
  model: string;
  /** Inferred from model ID: 'bedrock' | 'azure'. */
  provider?: string;
  success: boolean;
  qualityScore: number;
  durationMs: number;
  /**
   * Surface label stored in `sheet_type`.
   * Callers should pass 'inspector_chat' or 'workbench_<artifactType>'.
   */
  sheetType: string;
  /** `workbench_sessions.id` — stored in `error_type` column for traceability. */
  sessionId?: string;
}

function inferProvider(modelId: string): string {
  if (modelId.startsWith('us.anthropic') || modelId.startsWith('us.amazon') ||
      modelId.startsWith('us.meta') || modelId.startsWith('us.deepseek') ||
      modelId.startsWith('mistral') || modelId.startsWith('qwen')) {
    return 'bedrock';
  }
  return 'azure';
}

/**
 * Fire-and-forget: writes one row to `backfill_model_stats`.
 * Any error is swallowed so it never disrupts the calling chat stream.
 */
export async function reportToBandit(report: BanditReport): Promise<void> {
  try {
    const provider = report.provider ?? inferProvider(report.model);

    await prisma.backfill_model_stats.create({
      data: {
        sheet_type: report.sheetType,
        model_name: report.model,
        provider,
        success: report.success,
        duration_ms: Math.round(report.durationMs),
        quality_score: report.qualityScore,
        source: report.source,
        // Reuse error_type as a free-text session reference (no schema change needed)
        error_type: report.sessionId ? `session:${report.sessionId}` : null,
      },
    });
  } catch (err) {
    console.error('[lifecycle/report-bandit] insert failed:', err);
  }
}
