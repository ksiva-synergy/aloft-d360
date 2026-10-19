import { NextRequest } from 'next/server';
import { type Message, type ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { prisma } from '@/lib/db';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { runAgentLoop, type AgentLoopResult } from '@/lib/inspector/agent-loop';
import { getInspectorMaxLoops } from '@/lib/inspector/max-loops';
import { inspectorLlmConfigured, hasXaiCredentials } from '@/lib/inspector/llm-configured';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { resolveBoostModel, resolveWorkbenchModel } from '@/lib/construction/workbench-model';
import {
  buildWorkbenchSystemPrompt,
  buildWorkbenchToolConfig,
} from '@/lib/construction/prompts';
import type { ConstructionState } from '@/lib/construction/constructionState';
import { loadConstructionState, coerceConstructionState } from '@/lib/construction/load-state';
import { executeBuilderTool, inferAgentClass, type BuilderToolContext } from '@/lib/construction/builder-tools';
import { mergeUserEdits } from '@/lib/construction/user-edits';
import { withAgentOpsToolLog } from '@/lib/agent-ops/log-tool-invocation';
import { TurnMetricsRecorder } from '@/lib/agent-ops/record-turn-metrics';
import { getDefaultOrg } from '@/lib/platform/agents';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sessionId?: string;
    messages?: { role: string; content: string }[];
    model?: string;
  };

  const authBlock = await guardInspectorChat(request, body.sessionId);
  if (authBlock) return authBlock;

  if (!body.sessionId) {
    return new Response('sessionId required', { status: 400 });
  }

  if (!inspectorLlmConfigured()) {
    return new Response('Workbench chat requires a configured model backend (AWS Bedrock, instance profile, or xAI).', { status: 503 });
  }

  const resolved = resolveWorkbenchModel(body.model);
  if (!resolved) {
    return new Response('Model not available for workbench', { status: 400 });
  }
  const { modelKey, option, boostModel, effectiveModelId } = resolved;

  const row = await prisma.workbench_sessions.findUnique({ where: { id: body.sessionId } });
  if (!row) return new Response('Session not found', { status: 404 });

  const org = await getDefaultOrg();
  let constructionState: ConstructionState = loadConstructionState(row.construction_state, org.id);

  const userMessages: Message[] = (body.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content } as ContentBlock],
    }));

  if (userMessages.length === 0) {
    return new Response('No messages provided', { status: 400 });
  }
  if (userMessages[0].role !== 'user') {
    return new Response('First message must be from the user', { status: 400 });
  }

  const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content ?? '';
  const classHint = inferAgentClass(lastUser);
  const shouldSuggestClass = classHint && !constructionState.class?.id;

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

      const maxLoops = getInspectorMaxLoops();
      let stateRef = constructionState;

      let currentAgentLoop = 1;
      const turnMetrics = new TurnMetricsRecorder({ sessionId: body.sessionId ?? '', surface: 'workbench' });
      let toolErrorCount = 0;
      const ctx: BuilderToolContext = {
        getState: () => stateRef,
        setState: (next) => { stateRef = next; },
        emit,
        sessionId: body.sessionId ?? null,
        agentLoop: currentAgentLoop,
        model: effectiveModelId,
      };

      try {
        emit({
          type: 'stream_start',
          mode: 'workbench',
          model: effectiveModelId,
          modelKey,
          supportsThinking: option.supportsThinking,
          maxLoops,
        });

        if (shouldSuggestClass && classHint) {
          emit({
            type: 'class_suggestion',
            classId: classHint.classId,
            confidence: classHint.confidence,
            rationale: classHint.rationale,
          });
        }

        const loopParams = {
          modelId: effectiveModelId,
          systemPrompt: buildWorkbenchSystemPrompt(stateRef),
          messages: userMessages,
          tools: buildWorkbenchToolConfig(),
          executeTool: (toolName: string, toolInput: Record<string, unknown>, callId: string) => {
            ctx.agentLoop = currentAgentLoop;
            return withAgentOpsToolLog(
              {
                sessionId: body.sessionId ?? null,
                runId: turnMetrics.turnId,
                loop: currentAgentLoop,
                toolName,
                callId,
                model: effectiveModelId,
              },
              toolInput,
              () => executeBuilderTool(toolName, toolInput, ctx),
            );
          },
          maxLoops,
          supportsTools: option.supportsTools,
          supportsThinking: option.supportsThinking,
          abortSignal: closed,
          onLoopStart: (loop: number, max: number) => {
            currentAgentLoop = loop;
            ctx.agentLoop = loop;
            emit({ type: 'loop_start', loop, maxLoops: max });
          },
          onTextChunk: (delta: string) => {
            turnMetrics.markFirstToken();
            emit({ type: 'text', delta });
          },
          onLoopMetrics: (m: import('@/lib/inspector/agent-loop').LoopMetrics) => turnMetrics.addLoop(m),
          onThinkingChunk: (delta: string) => emit({ type: 'thinking', delta }),
          onToolCallEvent: (event: import('@/lib/inspector/agent-loop').ToolCallEvent) => {
            if (event.type === 'tool_call_suggested') {
              emit({
                type: 'tool_call_suggested',
                callId: event.callId,
                toolId: event.toolName,
                toolName: event.toolName,
                reason: event.reason,
              });
            } else if (event.type === 'tool_call_running') {
              emit({
                type: 'tool_call_running',
                callId: event.callId,
                toolId: event.toolName,
                toolName: event.toolName,
                input: event.input,
              });
            } else if (event.type === 'tool_call_result') {
              emit({ type: 'tool_call_result', callId: event.callId, output: event.output, durationMs: event.durationMs });
            } else if (event.type === 'tool_call_error') {
              emit({ type: 'tool_call_error', callId: event.callId, error: event.error, retryable: event.retryable });
            }
          },
        };

        let result: AgentLoopResult = boostModel
          ? await dispatchAgentLoop(boostModel, loopParams)
          : await runAgentLoop(loopParams);

        if (!boostModel && result.outcome === 'errored' && hasXaiCredentials()) {
          const grok = resolveBoostModel('grok-xai');
          if (grok) {
            emit({ type: 'text', delta: 'Primary model unavailable — retrying with Grok 4.7…\n\n' });
            result = await dispatchAgentLoop(grok, { ...loopParams, modelId: grok.modelId });
          }
        }

        if (result.outcome === 'errored' && result.errorDetail) {
          emit({ type: 'error', message: result.errorDetail, recoverable: true });
        }

        toolErrorCount = result.toolCalls.filter((t) => t.status === 'error').length;
        void turnMetrics.flush({
          model: effectiveModelId,
          outcome: closed.value && result.outcome !== 'completed' ? 'aborted' : result.outcome,
          toolCalls: result.toolCalls.length,
          toolErrors: toolErrorCount,
          error: result.errorDetail ?? null,
        });

        stateRef = coerceConstructionState(stateRef);
        // Keep Config-panel edits (and test runs) made while this turn was streaming.
        const latest = await prisma.workbench_sessions.findUnique({
          where: { id: body.sessionId },
          select: { construction_state: true },
        });
        if (latest) stateRef = mergeUserEdits(stateRef, loadConstructionState(latest.construction_state, org.id));
        await prisma.workbench_sessions.update({
          where: { id: body.sessionId },
          data: {
            construction_state: stateRef as unknown as object,
            readiness: stateRef.readiness,
            updated_at: new Date(),
          },
        });

        emit({ type: 'construction_state', state: stateRef });
        emit({
          type: 'done',
          outcome: result.outcome,
          loops: result.loops,
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
          model: effectiveModelId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Workbench stream failed';
        void turnMetrics.flush({ model: effectiveModelId, outcome: 'errored', toolCalls: 0, toolErrors: toolErrorCount, error: msg });
        emit({ type: 'error', message: msg, recoverable: true });
        emit({
          type: 'done',
          outcome: 'errored',
          loops: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
          model: effectiveModelId,
        });
      } finally {
        if (!closed.value) {
          closed.value = true;
          try { controller.close(); } catch { /* noop */ }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
