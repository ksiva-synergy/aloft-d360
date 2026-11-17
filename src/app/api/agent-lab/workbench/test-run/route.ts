import { NextRequest } from 'next/server';
import { clientStreamError } from '@/lib/inspector/client-stream-error';
import type { ContentBlock, Message } from '@aws-sdk/client-bedrock-runtime';
import { prisma } from '@/lib/db';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { type AgentLoopResult } from '@/lib/inspector/agent-loop';
import { hasLlmLiteCredentials, inspectorLlmConfigured } from '@/lib/inspector/llm-configured';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { INSPECTOR_TOOLS } from '@/lib/inspector/prompts';
import { executeInspectorTool, resolveToolCatalogEntry } from '@/lib/inspector/tools';
import { principalForUser } from '@/lib/access/principal';
import type { QueryResult } from '@/hooks/useInspectorChat';
import { withAgentOpsToolLog } from '@/lib/agent-ops/log-tool-invocation';
import { buildTestRunSystemPrompt } from '@/lib/construction/prompts';
import { loadConstructionState } from '@/lib/construction/load-state';
import { resolveWorkbenchModel } from '@/lib/construction/workbench-model';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getSessionUserRole } from '@/lib/inspector/session-role';
import { TurnMetricsRecorder } from '@/lib/agent-ops/record-turn-metrics';
import { assertInteractiveBudget, BudgetExceededError } from '@/lib/spend/budgets';
import { budgetExceededStreamResponse } from '@/lib/spend/budget-response';
import { logInteractiveLlmTurn } from '@/lib/spend/log-llm-turn';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Read-only data tools only: no charts, exports or disambiguation cards in a test run. */
const TEST_RUN_TOOLS = new Set(['describe_schema', 'execute_tool']);
const TEST_RUN_MAX_LOOPS = 8;

/**
 * Runs one sample question through the draft agent (its instructions + read-only
 * Databricks tools) and records the outcome on construction_state.validation.
 * Streams the same SSE event shapes as the workbench chat.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { sessionId?: string; question?: string; model?: string };
  const authBlock = await guardInspectorChat(request, body.sessionId);
  if (authBlock) return authBlock;

  const question = body.question?.trim() ?? '';
  if (!body.sessionId || !question) {
    return new Response('sessionId and question required', { status: 400 });
  }
  if (question.length > 2000) {
    return new Response('Question is too long (max 2000 characters)', { status: 400 });
  }
  if (!inspectorLlmConfigured() || !hasLlmLiteCredentials()) {
    return new Response('Test run requires LLM Lite gateway credentials (LLMLITE_BASE_URL and LLMLITE_API_KEY).', { status: 503 });
  }
  const role = await getSessionUserRole();
  const resolved = resolveWorkbenchModel(body.model, role);
  if (!resolved) return new Response('Model not available for workbench', { status: 400 });
  const { option, boostModel } = resolved;
  let effectiveModelId = resolved.effectiveModelId;

  const row = await prisma.workbench_sessions.findUnique({
    where: { id: body.sessionId },
    select: { construction_state: true, user_id: true },
  });
  if (!row) return new Response('Session not found', { status: 404 });

  const org = await getDefaultOrg();
  const state = loadConstructionState(row.construction_state, org.id);
  if ((state.prompt.instructions?.trim().length ?? 0) < 20) {
    return new Response('Write the agent instructions first — a test run needs something to follow.', { status: 400 });
  }

  try {
    await assertInteractiveBudget({ orgId: org.id, userId: row.user_id ?? null, role });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return budgetExceededStreamResponse(err, effectiveModelId);
    }
    throw err;
  }

  let connectionId: string | null = null;
  try {
    const entry = await resolveToolCatalogEntry('');
    connectionId = (entry?.config as Record<string, string> | null)?.connection_id ?? null;
  } catch { /* no warehouse — describe_schema still works */ }

  const sessionId = body.sessionId;
  const dataPrincipal = row.user_id ? await principalForUser(row.user_id, org.id) : null;
  const runId = `test-run-${crypto.randomUUID()}`;
  const turnMetrics = new TurnMetricsRecorder({ sessionId, surface: 'workbench_test_run' });
  const messages: Message[] = [{ role: 'user', content: [{ text: question } as ContentBlock] }];

  const stream = new ReadableStream({
    async start(controller) {
      const closed = { value: false };
      const encoder = new TextEncoder();
      request.signal.addEventListener('abort', () => {
        closed.value = true;
        try { controller.close(); } catch { /* already closed */ }
      });
      const emit = (event: Record<string, unknown>) => {
        if (closed.value) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed.value = true;
        }
      };

      const queryResults: QueryResult[] = [];
      const emitTracked = (event: Record<string, unknown>) => {
        if (event.type === 'query_result') queryResults.push(event as unknown as QueryResult);
        emit(event);
      };

      let answer = '';
      try {
        emit({ type: 'stream_start', mode: 'test_run', model: effectiveModelId });
        const loopParams = {
          modelId: effectiveModelId,
          systemPrompt: buildTestRunSystemPrompt(state),
          messages,
          tools: { tools: INSPECTOR_TOOLS.filter((t) => TEST_RUN_TOOLS.has(t.toolSpec?.name ?? '')) },
          executeTool: (toolName: string, toolInput: Record<string, unknown>, callId: string) => {
            if (!TEST_RUN_TOOLS.has(toolName)) {
              return Promise.resolve(JSON.stringify({ error: `Tool ${toolName} is not available in a test run` }));
            }
            return withAgentOpsToolLog(
              { sessionId, runId, loop: 0, toolName, callId, model: effectiveModelId },
              toolInput,
              () => executeInspectorTool(toolName, toolInput, callId, emitTracked, {
                queryResults,
                model: effectiveModelId,
                lastUserMessage: question,
                sessionId,
                connectionId,
                dataPrincipal,
              }),
            );
          },
          maxLoops: TEST_RUN_MAX_LOOPS,
          supportsTools: option.supportsTools,
          supportsThinking: false,
          // Bedrock Claude only: cache system+tools and the growing conversation across loops.
          cacheConversation: true,
          abortSignal: closed,
          onTextChunk: (delta: string) => {
            answer += delta;
            emit({ type: 'text', delta });
          },
          onLoopMetrics: (m: import('@/lib/inspector/agent-loop').LoopMetrics) => turnMetrics.addLoop(m),
          onModelSwitch: (modelId: string) => { effectiveModelId = modelId; },
          onToolCallEvent: (event: import('@/lib/inspector/agent-loop').ToolCallEvent) => {
            if (event.type === 'tool_call_running') {
              emit({ type: 'tool_call_running', callId: event.callId, toolName: event.toolName, input: event.input });
            } else if (event.type === 'tool_call_result') {
              emit({ type: 'tool_call_result', callId: event.callId, durationMs: event.durationMs });
            } else if (event.type === 'tool_call_error') {
              emit({ type: 'tool_call_error', callId: event.callId, error: event.error });
            }
          },
        };

        const result: AgentLoopResult = await dispatchAgentLoop(boostModel, loopParams);

        if (result.outcome === 'errored' && result.errorDetail) {
          emit({ type: 'error', message: clientStreamError(result.errorDetail, 'workbench/test-run') });
        }

        if (result.usage.inputTokens + result.usage.outputTokens > 0) {
          void logInteractiveLlmTurn({
            orgId: org.id,
            userId: row.user_id,
            surface: 'workbench',
            action: 'test_run',
            model: effectiveModelId,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            sessionId,
            turnId: turnMetrics.turnId,
            status: result.outcome === 'errored' ? 'failed' : result.outcome,
            durationMs: turnMetrics.elapsedMs(),
            toolCalls: result.toolCalls.length,
          });
        }

        const testRun = {
          question,
          at: new Date().toISOString(),
          outcome: result.outcome,
          toolCalls: result.toolCalls.length,
          toolErrors: result.toolCalls.filter((t) => t.status === 'error').length,
          answerPreview: (result.finalText ?? answer).trim().slice(0, 600),
        };

        // Re-read so a Config-panel edit made during the run is not overwritten.
        const latest = await prisma.workbench_sessions.findUnique({
          where: { id: sessionId },
          select: { construction_state: true },
        });
        if (latest) {
          const current = loadConstructionState(latest.construction_state, org.id);
          await prisma.workbench_sessions.update({
            where: { id: sessionId },
            data: {
              construction_state: { ...current, validation: { lastTestRun: testRun } } as unknown as object,
              updated_at: new Date(),
            },
          });
        }

        emit({ type: 'test_run_recorded', testRun });
        emit({
          type: 'done',
          outcome: result.outcome,
          loops: result.loops,
          usage: result.usage,
          model: effectiveModelId,
        });
      } catch (err: unknown) {
        emit({ type: 'error', message: clientStreamError(err, 'workbench/test-run') });
        emit({ type: 'done', outcome: 'errored' });
      } finally {
        if (!closed.value) {
          try { controller.close(); } catch { /* already closed */ }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
