import { NextRequest } from 'next/server';
import type { ContentBlock, Message } from '@aws-sdk/client-bedrock-runtime';
import { prisma } from '@/lib/db';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { runAgentLoop, type AgentLoopResult } from '@/lib/inspector/agent-loop';
import { inspectorLlmConfigured } from '@/lib/inspector/llm-configured';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { INSPECTOR_TOOLS } from '@/lib/inspector/prompts';
import { executeInspectorTool, resolveToolCatalogEntry } from '@/lib/inspector/tools';
import type { QueryResult } from '@/hooks/useInspectorChat';
import { withAgentOpsToolLog } from '@/lib/agent-ops/log-tool-invocation';
import { buildRuntimeSystemPrompt } from '@/lib/construction/prompts';
import { runtimeBriefFromCatalog } from '@/lib/construction/catalog-sync';
import { resolveWorkbenchModel } from '@/lib/construction/workbench-model';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const USE_TOOLS = new Set(['describe_schema', 'execute_tool']);
const USE_MAX_LOOPS = 8;
const MAX_HISTORY = 30;
const MAX_MESSAGE = 8000;

type Turn = { role: 'user' | 'assistant'; content: string };

function parseHistory(raw: unknown): Turn[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return { error: 'history must be a list of messages' };
  if (raw.length > MAX_HISTORY) return { error: `history is limited to ${MAX_HISTORY} messages` };
  const turns: Turn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { error: 'history contains an invalid message' };
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return { error: 'history messages need a role of user or assistant and string content' };
    }
    const text = content.trim();
    if (!text) continue;
    if (text.length > MAX_MESSAGE) return { error: `a history message is longer than ${MAX_MESSAGE} characters` };
    const previous = turns[turns.length - 1];
    if (previous?.role === role) previous.content = `${previous.content}\n\n${text}`;
    else turns.push({ role, content: text });
  }
  return turns;
}

/**
 * One turn of a saved agent. The catalog instructions are the system prompt;
 * the caller sends prior turns. This does not modify the workbench draft.
 */
export async function POST(request: NextRequest) {
  let body: { slug?: string; message?: string; history?: unknown; model?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const authBlock = await guardInspectorChat(request, undefined);
  if (authBlock) return authBlock;

  const slug = body.slug?.trim() ?? '';
  let message = body.message?.trim() ?? '';
  if (!slug || !message) return new Response('slug and message required', { status: 400 });
  if (message.length > MAX_MESSAGE) return new Response(`Message is too long (max ${MAX_MESSAGE} characters)`, { status: 400 });

  const parsedHistory = parseHistory(body.history);
  if ('error' in parsedHistory) return new Response(parsedHistory.error, { status: 400 });
  // A previous turn can end on the user (stopped or empty reply). Fold it into this message
  // so the model still sees alternating roles.
  let history = parsedHistory;
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    message = `${history[history.length - 1].content}\n\n${message}`;
    history = history.slice(0, -1);
  }

  if (!inspectorLlmConfigured()) {
    return new Response('Using an agent requires a configured model backend (AWS Bedrock, instance profile, or xAI).', { status: 503 });
  }
  const resolved = resolveWorkbenchModel(body.model);
  if (!resolved) return new Response('Model not available', { status: 400 });
  const { option, boostModel, effectiveModelId } = resolved;

  const agent = await prisma.agent_catalog.findFirst({ where: { slug } });
  if (!agent) return new Response('Agent not found', { status: 404 });
  const brief = runtimeBriefFromCatalog(agent);
  if (!brief) return new Response('This agent has no instructions to run.', { status: 400 });

  const platformAgentId = agent.config && typeof agent.config === 'object' && !Array.isArray(agent.config)
    && typeof (agent.config as { platformAgentId?: unknown }).platformAgentId === 'string'
    ? (agent.config as { platformAgentId: string }).platformAgentId
    : null;
  if (platformAgentId) {
    void prisma.platformAgent.update({
      where: { id: platformAgentId },
      data: { last_activity: new Date() },
    }).catch((err) => console.error('[agent-lab/agents/chat] last_activity update failed', err));
  }

  let connectionId: string | null = null;
  try {
    const entry = await resolveToolCatalogEntry('');
    connectionId = (entry?.config as Record<string, string> | null)?.connection_id ?? null;
  } catch { /* no warehouse — describe_schema still works */ }

  const messages: Message[] = [
    ...history.map((turn) => ({ role: turn.role, content: [{ text: turn.content } as ContentBlock] })),
    { role: 'user' as const, content: [{ text: message } as ContentBlock] },
  ];
  const runId = `agent-use-${crypto.randomUUID()}`;

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

      try {
        emit({ type: 'stream_start', mode: 'agent_use', model: effectiveModelId, agent: agent.name });
        const loopParams = {
          modelId: effectiveModelId,
          systemPrompt: buildRuntimeSystemPrompt({ ...brief, mode: 'live' }),
          messages,
          tools: { tools: INSPECTOR_TOOLS.filter((t) => USE_TOOLS.has(t.toolSpec?.name ?? '')) },
          executeTool: (toolName: string, toolInput: Record<string, unknown>, callId: string) => {
            if (!USE_TOOLS.has(toolName)) {
              return Promise.resolve(JSON.stringify({ error: `Tool ${toolName} is not available when using this agent` }));
            }
            return withAgentOpsToolLog(
              { sessionId: agent.id, runId, loop: 0, toolName, callId, model: effectiveModelId },
              toolInput,
              () => executeInspectorTool(toolName, toolInput, callId, emitTracked, {
                queryResults,
                model: effectiveModelId,
                lastUserMessage: message,
                sessionId: agent.id,
                connectionId,
              }),
            );
          },
          maxLoops: USE_MAX_LOOPS,
          supportsTools: option.supportsTools,
          supportsThinking: false,
          abortSignal: closed,
          onTextChunk: (delta: string) => emit({ type: 'text', delta }),
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

        const result: AgentLoopResult = boostModel
          ? await dispatchAgentLoop(boostModel, loopParams)
          : await runAgentLoop(loopParams);

        if (result.outcome === 'errored' && result.errorDetail) {
          emit({ type: 'error', message: result.errorDetail });
        }
        emit({
          type: 'done',
          outcome: result.outcome,
          loops: result.loops,
          usage: result.usage,
          model: effectiveModelId,
        });
      } catch (err: unknown) {
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Agent chat failed' });
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
