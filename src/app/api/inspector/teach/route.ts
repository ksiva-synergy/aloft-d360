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
import { type Message, type ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { resolveToolCatalogEntry } from '@/lib/inspector/tools';
import { runAgentLoop } from '@/lib/inspector/agent-loop';
import { MARCUS_REFLECT_SYSTEM_PROMPT } from '@/lib/inspector/reflect-prompt';
import {
  buildReflectToolConfig,
  executeReflectTool,
  type ReflectToolContext,
} from '@/lib/inspector/reflect-tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Reflect is a reasoning/extraction task — default to a tool-capable Claude model.
const REFLECT_MODELS: Record<string, { bedrockId: string; supportsThinking: boolean }> = {
  'sonnet-4-6': { bedrockId: 'us.anthropic.claude-sonnet-4-6', supportsThinking: true },
  'opus-4-6': { bedrockId: 'us.anthropic.claude-opus-4-6-v1', supportsThinking: true },
  'haiku-4-5': { bedrockId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', supportsThinking: false },
};
const DEFAULT_REFLECT_MODEL = 'sonnet-4-6';

function isBedrockConfigured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
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

  const modelConfig = REFLECT_MODELS[body.model ?? ''] ?? REFLECT_MODELS[DEFAULT_REFLECT_MODEL];

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

  // Resolve org, caller, and the governed connection (for verify_claim).
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
  };

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

      try {
        emit({ type: 'stream_start', mode: 'reflect', model: modelConfig.bedrockId, maxLoops: 8 });

        const result = await runAgentLoop({
          modelId: modelConfig.bedrockId,
          systemPrompt: MARCUS_REFLECT_SYSTEM_PROMPT,
          messages: userMessages,
          tools: buildReflectToolConfig(),
          executeTool: (toolName, toolInput, callId) =>
            executeReflectTool(toolName, toolInput, callId, emit, toolContext),
          maxLoops: 8,
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

        emit({
          type: 'done',
          outcome: result.outcome,
          loops: result.loops,
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
          model: modelConfig.bedrockId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Reflect stream failed';
        emit({ type: 'error', message: msg, recoverable: true });
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
