/**
 * Wraps an LLM invocation so latency / tokens / cost land in `llm_calls` on both
 * success and failure. ALWAYS pass redacted payloads (see redact.ts) — never the
 * raw request/response — because these columns are plaintext JSONB today. When
 * full-fidelity retention is required, envelope-encrypt with Azure Key Vault
 * before write (MIGRATION_RUNBOOK Phase 5a); that layer is not implemented yet.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { redact } from '@/lib/redact';

export interface TraceMeta {
  sessionId: string;
  actionId?: string | null;
  provider: string; // openai | anthropic | azure | ...
  model: string;
  requestId?: string | null;
  temperature?: number | null;
  /** Raw request; it is redacted here before persistence. */
  requestPayload?: unknown;
}

export interface TraceResult {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  finishReason?: string | null;
  /** Raw response; redacted here before persistence. */
  responsePayload?: unknown;
}

const asJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined || v === null ? undefined : (redact(v) as Prisma.InputJsonValue);

/**
 * Run `fn`, timing it and recording an llm_calls row. `extract` pulls token/cost
 * accounting out of the provider's response shape. Errors are recorded with
 * status ERROR and then re-thrown so the caller still sees the failure.
 */
export async function traceLlmCall<T>(
  meta: TraceMeta,
  fn: () => Promise<T>,
  extract?: (result: T) => TraceResult,
): Promise<T> {
  const startedAt = Date.now();
  const reqJson = asJson(meta.requestPayload);
  try {
    const result = await fn();
    const info = extract?.(result) ?? {};
    const respJson = asJson(info.responsePayload);
    await prisma.llmCall.create({
      data: {
        sessionId: meta.sessionId,
        actionId: meta.actionId ?? null,
        provider: meta.provider,
        model: meta.model,
        requestId: meta.requestId ?? null,
        status: 'SUCCESS',
        promptTokens: info.promptTokens ?? null,
        completionTokens: info.completionTokens ?? null,
        totalTokens: info.totalTokens ?? null,
        costUsd: info.costUsd != null ? new Prisma.Decimal(info.costUsd) : null,
        latencyMs: Date.now() - startedAt,
        temperature: meta.temperature ?? null,
        finishReason: info.finishReason ?? null,
        ...(reqJson !== undefined ? { requestPayload: reqJson } : {}),
        ...(respJson !== undefined ? { responsePayload: respJson } : {}),
      },
    });
    return result;
  } catch (e) {
    await prisma.llmCall
      .create({
        data: {
          sessionId: meta.sessionId,
          actionId: meta.actionId ?? null,
          provider: meta.provider,
          model: meta.model,
          requestId: meta.requestId ?? null,
          status: 'ERROR',
          latencyMs: Date.now() - startedAt,
          temperature: meta.temperature ?? null,
          error: e instanceof Error ? e.message : String(e),
          ...(reqJson !== undefined ? { requestPayload: reqJson } : {}),
        },
      })
      .catch((writeErr) => console.error('[llm-tracing] failed to record error row', writeErr));
    throw e;
  }
}
