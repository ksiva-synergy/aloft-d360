import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { guardInspectorChat, resolveInspectorPrincipal } from '@/lib/inspector/session-auth';
import { inspectorLlmConfigured } from '@/lib/inspector/llm-configured';
import { runtimeBriefFromCatalog } from '@/lib/construction/catalog-sync';
import { resolveWorkbenchModel } from '@/lib/construction/workbench-model';
import { getSessionUserRole } from '@/lib/inspector/session-role';
import { runCatalogAgent } from '@/lib/agents/run-catalog-agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// The run itself (tools, rounds, metrics) lives in src/lib/agents/run-catalog-agent.ts.
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
  const role = await getSessionUserRole();
  // Who is chatting, so the agent searches only knowledge bases this person may see.
  const principal = await resolveInspectorPrincipal(request).catch(() => null);
  const person = principal?.kind === 'user' ? { userId: principal.userId, role: role ?? 'member' } : null;
  const resolved = resolveWorkbenchModel(body.model, role);
  if (!resolved) return new Response('Model not available', { status: 400 });
  const { effectiveModelId } = resolved;

  // Checked here so these keep their HTTP status; the run itself is shared with Automate.
  const agent = await prisma.agent_catalog.findFirst({ where: { slug } });
  if (!agent) return new Response('Agent not found', { status: 404 });
  if (!runtimeBriefFromCatalog(agent)) return new Response('This agent has no instructions to run.', { status: 400 });

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

      try {
        emit({ type: 'stream_start', mode: 'agent_use', model: effectiveModelId, agent: agent.name });
        const result = await runCatalogAgent({
          slug,
          message,
          history,
          role,
          model: body.model,
          surface: 'agent_use',
          person,
          abort: closed,
          onTextChunk: (delta) => emit({ type: 'text', delta }),
          onToolEvent: emit,
          onToolCallEvent: (event) => {
            if (event.type === 'tool_call_running') {
              emit({ type: 'tool_call_running', callId: event.callId, toolName: event.toolName, input: event.input });
            } else if (event.type === 'tool_call_result') {
              emit({ type: 'tool_call_result', callId: event.callId, durationMs: event.durationMs });
            } else if (event.type === 'tool_call_error') {
              emit({ type: 'tool_call_error', callId: event.callId, error: event.error });
            }
          },
        });

        if (result.outcome === 'errored' && result.errorDetail) {
          emit({ type: 'error', message: result.errorDetail });
        }
        emit({
          type: 'done',
          outcome: result.outcome,
          loops: result.loops,
          usage: result.usage,
          model: result.model,
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
