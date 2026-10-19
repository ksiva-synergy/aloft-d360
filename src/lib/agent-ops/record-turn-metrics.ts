import 'server-only';

import { prisma } from '@/lib/db';
import type { LoopMetrics } from '@/lib/inspector/agent-loop';

/**
 * Collects per-loop metrics during one agent turn and persists a turn row plus one row per
 * loop. Server-side so turn timing no longer depends on the browser saving `turnOps`.
 */
export class TurnMetricsRecorder {
  readonly turnId: string;
  private readonly startedAt = Date.now();
  private firstTokenAt: number | null = null;
  private loops: LoopMetrics[] = [];
  private flushed = false;

  constructor(
    private readonly meta: { sessionId: string; surface: string },
    turnId?: string,
  ) {
    this.turnId = turnId ?? crypto.randomUUID();
  }

  /** Call on the first streamed text chunk of the turn (user-perceived TTFT). */
  markFirstToken(): void {
    if (this.firstTokenAt === null) this.firstTokenAt = Date.now();
  }

  addLoop(m: LoopMetrics): void {
    this.loops.push(m);
  }

  /** Fire-and-forget; safe to call more than once (only the first call writes). */
  async flush(params: {
    model: string | null;
    outcome: 'completed' | 'truncated' | 'errored' | 'aborted';
    toolCalls: number;
    toolErrors: number;
    error?: string | null;
  }): Promise<void> {
    if (this.flushed || !this.meta.sessionId) return;
    this.flushed = true;

    const sum = (f: (l: LoopMetrics) => number) => this.loops.reduce((s, l) => s + f(l), 0);
    const startedAt = new Date(this.startedAt);

    try {
      await prisma.$transaction([
        prisma.agent_turn_log.create({
          data: {
            turn_id: this.turnId,
            session_id: this.meta.sessionId,
            surface: this.meta.surface,
            model: params.model,
            started_at: startedAt,
            duration_ms: Date.now() - this.startedAt,
            first_token_ms: this.firstTokenAt !== null ? this.firstTokenAt - this.startedAt : null,
            llm_ms: sum((l) => l.llmMs),
            tool_ms: sum((l) => l.toolMs),
            loops: this.loops.length,
            tool_calls: params.toolCalls,
            tool_errors: params.toolErrors,
            input_tokens: sum((l) => l.inputTokens),
            output_tokens: sum((l) => l.outputTokens),
            cache_read_tokens: sum((l) => l.cacheReadTokens),
            cache_write_tokens: sum((l) => l.cacheWriteTokens),
            peak_context_chars: this.loops.reduce((m, l) => Math.max(m, l.contextChars), 0),
            outcome: params.outcome,
            error: params.error?.slice(0, 2000) ?? null,
          },
        }),
        prisma.agent_loop_log.createMany({
          data: this.loops.map((l) => ({
            turn_id: this.turnId,
            session_id: this.meta.sessionId,
            loop: l.loop,
            model: params.model,
            started_at: new Date(l.startedAt),
            llm_ms: l.llmMs,
            first_token_ms: l.firstTokenMs,
            tool_ms: l.toolMs,
            input_tokens: l.inputTokens,
            output_tokens: l.outputTokens,
            cache_read_tokens: l.cacheReadTokens,
            cache_write_tokens: l.cacheWriteTokens,
            context_messages: l.contextMessages,
            context_chars: l.contextChars,
            tool_calls: l.toolCalls,
            stop_reason: l.stopReason,
          })),
        }),
      ]);
    } catch (err) {
      // Table may not exist yet before the migration is applied — never break chat.
      console.error('[agent-ops] turn metrics insert failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Token totals across recorded loops (input includes cached tokens), or null when no
   * loop reported — callers then fall back to the provider's own usage totals.
   */
  tokenTotals(): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | null {
    if (this.loops.length === 0) return null;
    const sum = (f: (l: LoopMetrics) => number) => this.loops.reduce((s, l) => s + f(l), 0);
    return {
      inputTokens: sum((l) => l.inputTokens),
      outputTokens: sum((l) => l.outputTokens),
      cacheReadTokens: sum((l) => l.cacheReadTokens),
      cacheWriteTokens: sum((l) => l.cacheWriteTokens),
    };
  }

  /** Duration so far — for loggers (cost log) that want the turn's wall time. */
  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}
