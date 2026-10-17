import { NextRequest } from 'next/server';
import { type Message, type ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { prisma } from '@/lib/db';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { runAgentLoop, type AgentLoopResult } from '@/lib/inspector/agent-loop';
import { getInspectorMaxLoops } from '@/lib/inspector/max-loops';
import { inspectorLlmConfigured, hasXaiCredentials } from '@/lib/inspector/llm-configured';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { BOOST_MODELS, type BoostModel } from '@/lib/boost/models';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';
import {
  buildWorkbenchSystemPrompt,
  buildWorkbenchToolConfig,
} from '@/lib/construction/prompts';
import type { ConstructionState } from '@/lib/construction/constructionState';
import { loadConstructionState, coerceConstructionState } from '@/lib/construction/load-state';
import { executeBuilderTool, inferAgentClass, type BuilderToolContext } from '@/lib/construction/builder-tools';
import { getDefaultOrg } from '@/lib/platform/agents';
import { AVAILABLE_MODELS } from '@/components/agent-lab/workbench/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_MODEL = hasXaiCredentials() ? DEFAULT_INSPECTOR_MODEL_KEY : 'sonnet-5-5';

const FOUNDRY_MODEL_KEYS = new Set(
  BOOST_MODELS.filter((m) => m.apiType === 'foundry').map((m) => m.key),
);

function resolveBoostModel(modelKey: string): BoostModel | null {
  let boost = BOOST_MODELS.find((m) => m.key === modelKey);
  if (!boost) return null;
  if (boost.key === 'grok-xai' && process.env.XAI_MODEL) {
    boost = { ...boost, modelId: process.env.XAI_MODEL };
  }
  return boost;
}

function resolveBedrockModelId(modelKey: string): string {
  const m = AVAILABLE_MODELS.find((x) => x.key === modelKey);
  if (m?.bedrockId && !FOUNDRY_MODEL_KEYS.has(modelKey)) return m.bedrockId;
  const fallback = AVAILABLE_MODELS.find((x) => x.key === 'sonnet-5-5');
  return fallback?.bedrockId ?? 'us.anthropic.claude-sonnet-5-5';
}

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

  const modelKey = body.model ?? DEFAULT_MODEL;
  const option = AVAILABLE_MODELS.find((m) => m.key === modelKey)
    ?? AVAILABLE_MODELS.find((m) => m.key === DEFAULT_MODEL);
  if (!option) {
    return new Response('Model not available for workbench', { status: 400 });
  }
  const boostModel = FOUNDRY_MODEL_KEYS.has(modelKey) ? resolveBoostModel(modelKey) : null;
  const bedrockModelId = resolveBedrockModelId(modelKey);
  const effectiveModelId = boostModel?.modelId ?? bedrockModelId;

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

      const ctx: BuilderToolContext = {
        getState: () => stateRef,
        setState: (next) => { stateRef = next; },
        emit,
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
          executeTool: (toolName: string, toolInput: Record<string, unknown>, _callId: string) =>
            executeBuilderTool(toolName, toolInput, ctx),
          maxLoops,
          supportsTools: option.supportsTools,
          supportsThinking: option.supportsThinking,
          abortSignal: closed,
          onLoopStart: (loop: number, max: number) => emit({ type: 'loop_start', loop, maxLoops: max }),
          onTextChunk: (delta: string) => emit({ type: 'text', delta }),
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

        stateRef = coerceConstructionState(stateRef);
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
