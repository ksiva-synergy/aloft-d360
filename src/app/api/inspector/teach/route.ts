/**
 * src/app/api/inspector/teach/route.ts
 *
 * Teach / "Marcus Reflect" — the learning-mode agent loop (Phase 1).
 *
 * This is NOT a fork of /api/inspector/chat. It reuses the same loop internals
 * (runAgentLoop, guardInspectorChat, resolveToolCatalogEntry) but swaps in:
 *   - the Marcus Reflect system prompt (reflect-prompt.ts) — layer one of the
 *     two-layer "no tasks" control, and
 *   - the Reflect tool allowlist (buildReflectToolConfig / executeReflectTool) —
 *     layer two: read + candidate-only tools, every mutation tool withheld.
 *
 * It deliberately omits the chat route's bandit/cost/judge/reflection lifecycle
 * machinery, which is meaningless for a knowledge-capture loop.
 */

import { NextRequest } from 'next/server';
import { clientStreamError } from '@/lib/inspector/client-stream-error';
import { type Message, type ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { resolveToolCatalogEntry } from '@/lib/inspector/tools';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { boostModelFromLlmLiteKey } from '@/lib/llmlite/inspector-models';
import { isLlmLiteConfigured } from '@/lib/llmlite/config';
import { toLlmLiteModelKey } from '@/lib/llmlite/keys';
import { getFeatureGatewayModelId } from '@/lib/llmlite/model-settings-store';
import { getInspectorMaxLoops } from '@/lib/inspector/max-loops';
import { principalForUser } from '@/lib/access/principal';
import { MARCUS_REFLECT_SYSTEM_PROMPT } from '@/lib/inspector/reflect-prompt';
import {
  buildReflectToolConfig,
  executeReflectTool,
  type ReflectToolContext,
} from '@/lib/inspector/reflect-tools';
import { assertInteractiveBudget, BudgetExceededError } from '@/lib/spend/budgets';
import { budgetExceededStreamResponse } from '@/lib/spend/budget-response';
import { logInteractiveLlmTurn } from '@/lib/spend/log-llm-turn';
import { getSessionUserRole } from '@/lib/inspector/session-role';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isBedrockConfigured(): boolean {
  return isLlmLiteConfigured();
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sessionId?: string;
    messages?: { role: string; content: string }[];
    model?: string;
  };

  // Session-ownership guard — identical posture to /api/inspector/chat.
  const authBlock = await guardInspectorChat(request, body.sessionId);
  if (authBlock) return authBlock;

  const reflectGatewayModelId = await getFeatureGatewayModelId('teach_reflect');
  const modelConfig = { bedrockId: reflectGatewayModelId, supportsThinking: false };
  const reflectBoostModel = boostModelFromLlmLiteKey(
    toLlmLiteModelKey(reflectGatewayModelId),
    reflectGatewayModelId,
  );

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
    // Bedrock requires the first turn to be a user turn.
    return new Response('First message must be from the user', { status: 400 });
  }

  if (!isBedrockConfigured()) {
    return new Response('Reflect mode requires a configured model backend.', { status: 503 });
  }

  const org = await getDefaultOrg();
  let callerUserId: string | null = null;
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const caller = email ? await getUserByEmail(email) : null;
    callerUserId = caller?.id ?? null;
  } catch {
    /* fail-closed: no caller → capture disabled, org-only recall */
  }

  const role = await getSessionUserRole();
  try {
    await assertInteractiveBudget({ orgId: org.id, userId: callerUserId, role });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return budgetExceededStreamResponse(err, modelConfig.bedrockId);
    }
    throw err;
  }

  let connectionId: string | null = null;
  try {
    const catalogEntry = await resolveToolCatalogEntry('');
    connectionId = (catalogEntry?.config as Record<string, string> | null)?.connection_id ?? null;
  } catch {
    /* non-fatal — verify_claim will surface not_verifiable */
  }

  const toolContext: ReflectToolContext = {
    orgId: org.id,
    userId: callerUserId,
    connectionId,
    sessionId: body.sessionId ?? null,
    dataPrincipal: callerUserId ? await principalForUser(callerUserId, org.id) : null,
  };

  const turnId = randomUUID();

  const stream = new ReadableStream({
    async start(controller) {
      const closed = { value: false };
      const encoder = new TextEncoder();

      request.signal.addEventListener('abort', () => {
        closed.value = true;
        try { controller.close(); } catch {}
      });

      const emit = (event: Record<string, unknown>) => {
        if (closed.value) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed.value = true;
        }
      };

      const maxInspectorLoops = getInspectorMaxLoops();

      try {
        emit({ type: 'stream_start', mode: 'reflect', model: modelConfig.bedrockId, maxLoops: maxInspectorLoops });

        const result = await dispatchAgentLoop(reflectBoostModel, {
          modelId: modelConfig.bedrockId,
          systemPrompt: MARCUS_REFLECT_SYSTEM_PROMPT,
          messages: userMessages,
          tools: buildReflectToolConfig(),
          executeTool: (toolName, toolInput, callId) =>
            executeReflectTool(toolName, toolInput, callId, emit, toolContext),
          maxLoops: maxInspectorLoops,
          supportsTools: true,
          supportsThinking: modelConfig.supportsThinking,
          abortSignal: closed,
          onLoopStart: (loop, maxLoops) => emit({ type: 'loop_start', loop, maxLoops }),
          onTextChunk: (delta) => emit({ type: 'text', delta }),
          onThinkingChunk: (delta) => emit({ type: 'thinking', delta }),
          onToolCallEvent: (event) => {
            if (event.type === 'tool_call_suggested') {
              emit({ type: 'tool_call_suggested', callId: event.callId, toolName: event.toolName, reason: event.reason });
            } else if (event.type === 'tool_call_running') {
              emit({ type: 'tool_call_running', callId: event.callId, toolName: event.toolName, input: event.input });
            } else if (event.type === 'tool_call_result') {
              emit({ type: 'tool_call_result', callId: event.callId, output: event.output, durationMs: event.durationMs });
            } else if (event.type === 'tool_call_error') {
              emit({ type: 'tool_call_error', callId: event.callId, error: event.error, retryable: event.retryable });
            }
          },
        });

        if (result.usage.inputTokens + result.usage.outputTokens > 0) {
          void logInteractiveLlmTurn({
            orgId: org.id,
            userId: callerUserId,
            surface: 'inspector_teach',
            action: 'reflect_turn',
            model: modelConfig.bedrockId,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            sessionId: body.sessionId ?? null,
            turnId,
            status: result.outcome === 'errored' ? 'failed' : result.outcome,
          });
        }

        emit({
          type: 'done',
          outcome: result.outcome,
          loops: result.loops,
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
          model: modelConfig.bedrockId,
        });
      } catch (err: unknown) {
        emit({ type: 'error', message: clientStreamError(err, 'inspector/teach'), recoverable: true });
        emit({ type: 'done', outcome: 'errored', loops: 0, usage: { inputTokens: 0, outputTokens: 0 }, model: modelConfig.bedrockId });
      } finally {
        if (!closed.value) {
          closed.value = true;
          try { controller.close(); } catch {}
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
