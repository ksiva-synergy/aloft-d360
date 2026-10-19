import 'server-only';

import { prisma } from '@/lib/db';
import type { AgentOpsToolLogMeta, ToolInvocationStatus } from './types';
import { extractToolErrorFromJson, redactToolOutput, redactToolPayload } from './redact';
export { redactToolPayload };

function redactToolInput(input: Record<string, unknown> | undefined): unknown {
  if (!input) return null;
  return redactToolPayload(input);
}

function shouldSampleSuccess(): boolean {
  const rate = parseFloat(process.env.AGENT_OPS_SAMPLE_SUCCESS_RATE ?? '1');
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

function alwaysLogSlow(durationMs: number): boolean {
  const threshold = parseInt(process.env.AGENT_OPS_ALWAYS_LOG_SLOW_MS ?? '30000', 10);
  return durationMs >= threshold;
}

export async function logToolInvocation(params: {
  sessionId: string | null;
  runId?: string | null;
  loop: number;
  toolName: string;
  callId?: string;
  model?: string;
  status: ToolInvocationStatus;
  durationMs: number;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}): Promise<void> {
  const alwaysErrors = process.env.AGENT_OPS_ALWAYS_LOG_ERRORS !== 'false';
  const isError = params.status === 'error';
  if (
    !isError &&
    !alwaysLogSlow(params.durationMs) &&
    !(alwaysErrors && isError) &&
    !shouldSampleSuccess()
  ) {
    console.info(
      '[agent-ops] sampled skip',
      JSON.stringify({
        sessionId: params.sessionId,
        toolName: params.toolName,
        durationMs: params.durationMs,
      }),
    );
    return;
  }

  try {
    await prisma.tool_invocation_log.create({
      data: {
        session_id: params.sessionId,
        run_id: params.runId ?? params.callId ?? null,
        loop: params.loop,
        tool_name: params.toolName,
        input: redactToolInput(params.input) as object | undefined,
        output: redactToolOutput(params.toolName, params.output) as object | undefined,
        duration_ms: Math.max(0, Math.round(params.durationMs)),
        status: params.status,
        error: params.error?.slice(0, 2000) ?? null,
        model: params.model ?? null,
      },
    });
  } catch (err) {
    console.error('[agent-ops] insert failed:', err);
  }
}

export async function withAgentOpsToolLog(
  meta: AgentOpsToolLogMeta,
  toolInput: Record<string, unknown>,
  fn: () => Promise<string>,
): Promise<string> {
  const t0 = Date.now();
  try {
    const out = await fn();
    const errFromJson = extractToolErrorFromJson(out);
    const status: ToolInvocationStatus = errFromJson ? 'error' : 'success';
    void logToolInvocation({
      sessionId: meta.sessionId,
      runId: meta.runId,
      loop: meta.loop,
      toolName: meta.toolName,
      callId: meta.callId,
      model: meta.model,
      status,
      durationMs: Date.now() - t0,
      input: toolInput,
      output: status === 'success' ? out : undefined,
      error: errFromJson,
    });
    return out;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void logToolInvocation({
      sessionId: meta.sessionId,
      runId: meta.runId,
      loop: meta.loop,
      toolName: meta.toolName,
      callId: meta.callId,
      model: meta.model,
      status: 'error',
      durationMs: Date.now() - t0,
      input: toolInput,
      error: msg,
    });
    throw err;
  }
}
