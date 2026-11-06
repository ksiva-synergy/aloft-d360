import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { computeCostUsd, type CacheUsage } from '@/lib/lifecycle/log-agent-cost';
import { recordHarvestInfraSpend } from '@/lib/spend/harvest-infra';

export type SpendBucket = 'interactive' | 'harvest' | 'automation' | 'platform';

export interface RecordSpendEventInput {
  orgId: string;
  bucket: SpendBucket;
  surface: string;
  action: string;
  usd?: number;
  userId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cache?: CacheUsage;
  model?: string | null;
  status?: string;
  sessionId?: string | null;
  turnId?: string | null;
  jobId?: string | null;
  agentSlug?: string | null;
  jobKind?: string | null;
  sourceId?: string | null;
  /** Idempotency key parts — required for harvest; use turn id for chat turns. */
  referenceType: string;
  referenceId: string;
  meta?: Record<string, unknown>;
  occurredAt?: Date;
}

function statsUsd(stats: unknown): number | null {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  const v = (stats as Record<string, unknown>).cost_usd;
  return typeof v === 'number' && v > 0 ? v : null;
}

/** Record one harvest job into the ledger after finalize (idempotent per job). */
export async function recordHarvestJobSpend(jobId: string): Promise<void> {
  const job = await prisma.platformContextJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      org_id: true,
      job_kind: true,
      source_id: true,
      status: true,
      stats: true,
      finished_at: true,
      triggered_by_user_id: true,
      error: true,
    },
  });
  if (!job) return;

  const usd = statsUsd(job.stats);
  if (usd === null) return;

  const stats =
    job.stats && typeof job.stats === 'object' && !Array.isArray(job.stats)
      ? (job.stats as Record<string, unknown>)
      : {};

  await recordSpendEvent({
    orgId: job.org_id,
    bucket: 'harvest',
    surface: 'harvest',
    action: 'job_complete',
    usd,
    userId: job.triggered_by_user_id,
    jobId: job.id,
    jobKind: job.job_kind,
    sourceId: job.source_id,
    status: job.status,
    referenceType: 'platform_context_job',
    referenceId: job.id,
    occurredAt: job.finished_at ?? undefined,
    meta: {
      job_status: job.status,
      error: job.error ?? undefined,
      ...pickHarvestMeta(stats),
    },
  });
  void recordHarvestInfraSpend(jobId).catch((err) => {
    console.error('[spend/record-spend-event] recordHarvestInfraSpend failed', jobId, err);
  });
}

function pickHarvestMeta(stats: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'objects_enriched',
    'columns_enriched',
    'objects_profiled',
    'objects_processed',
    'input_tokens',
    'output_tokens',
    'skipped_stale',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (typeof stats[k] === 'number') out[k] = stats[k];
  }
  return out;
}

export async function recordSpendEvent(input: RecordSpendEventInput): Promise<void> {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const usd =
    input.usd ??
    (input.model
      ? computeCostUsd(input.model, inputTokens, outputTokens, input.cache ?? {})
      : 0);

  if (usd <= 0 && inputTokens <= 0 && outputTokens <= 0) return;

  try {
    await prisma.platformSpendEvent.create({
      data: {
        org_id: input.orgId,
        occurred_at: input.occurredAt ?? new Date(),
        bucket: input.bucket,
        user_id: input.userId ?? null,
        surface: input.surface,
        action: input.action,
        usd,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: input.cache?.readTokens ?? 0,
        cache_write_tokens: input.cache?.writeTokens ?? 0,
        model: input.model ?? null,
        status: input.status ?? 'success',
        session_id: input.sessionId ?? null,
        turn_id: input.turnId ?? null,
        job_id: input.jobId ?? null,
        agent_slug: input.agentSlug ?? null,
        job_kind: input.jobKind ?? null,
        source_id: input.sourceId ?? null,
        reference_type: input.referenceType,
        reference_id: input.referenceId,
        meta: input.meta ? (input.meta as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return;
    }
    console.error('[spend/record-spend-event] insert failed:', err);
  }
}

/** Log interactive LLM spend from token usage (Inspector, workbench, agents). */
export async function recordInteractiveLlmSpend(opts: {
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
  await recordSpendEvent({
    orgId: opts.orgId,
    bucket: 'interactive',
    surface: opts.surface,
    action: opts.action ?? 'turn',
    userId: opts.userId,
    model: opts.model,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    cache: opts.cache,
    sessionId: opts.sessionId,
    turnId: opts.turnId,
    agentSlug: opts.agentSlug,
    status: opts.status,
    referenceType: 'agent_turn',
    referenceId: opts.turnId,
    meta: {
      ...(opts.meta ?? {}),
      ...(opts.durationMs != null ? { duration_ms: opts.durationMs } : {}),
      ...(opts.toolCalls != null ? { tool_calls: opts.toolCalls } : {}),
    },
  });
}
