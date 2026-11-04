import 'server-only';

import { recordInteractiveLlmSpend } from '@/lib/spend/record-spend-event';
import type { CacheUsage } from '@/lib/lifecycle/log-agent-cost';

/** Record one interactive LLM turn in the unified ledger (all surfaces should use this). */
export async function logInteractiveLlmTurn(opts: {
  orgId: string;
  userId?: string | null;
  surface: string;
  action?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cache?: CacheUsage;
  sessionId?: string | null;
  turnId: string;
  agentSlug?: string | null;
  status?: string;
  durationMs?: number;
  toolCalls?: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await recordInteractiveLlmSpend(opts);
}
