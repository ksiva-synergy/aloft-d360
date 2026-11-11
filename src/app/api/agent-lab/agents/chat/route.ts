import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { guardInspectorChat, resolveInspectorPrincipal } from '@/lib/inspector/session-auth';
import { inspectorLlmConfigured } from '@/lib/inspector/llm-configured';
import { runtimeBriefFromCatalog } from '@/lib/construction/catalog-sync';
import { resolveWorkbenchModel } from '@/lib/construction/workbench-model';
import { getSessionUserRole } from '@/lib/inspector/session-role';
import { runCatalogAgent } from '@/lib/agents/run-catalog-agent';
import { clientStreamError } from '@/lib/inspector/client-stream-error';
import {
  appendAgentChatMessages,
  createAgentChat,
  getAgentChat,
  historyForModel,
  newChatMessage,
  type AgentChatMessage,
  type AgentTurn,
} from '@/lib/agents/agent-chats';
import { messagesForViewer, type AgentInspection } from '@/lib/agents/inspection';
import { clearTurnStop, isTurnStopped, turnStopKey } from '@/lib/chat/turn-control';
import { createDraftWriter } from '@/lib/chat/turn-draft';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// The run itself (tools, rounds, metrics) lives in src/lib/agents/run-catalog-agent.ts.
const MAX_HISTORY = 30;
const MAX_MESSAGE = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Turn = AgentTurn;

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
 * One turn of a saved agent. The catalog instructions are the system prompt.
 *
 * Signed-in people chat in a saved, private conversation: send `chatId` to continue one (omit it to
 * start a new one; its id comes back in the first `chat` event). History is read from the saved
 * chat, never from the request, and both messages are saved when the turn ends (also when stopped).
 * Service callers without a user stay stateless and may send `history`.
 * This does not modify the workbench draft.
 */
export async function POST(request: NextRequest) {
  let body: { slug?: string; message?: string; history?: unknown; chatId?: unknown; model?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const authBlock = await guardInspectorChat(request, undefined);
  if (authBlock) return authBlock;

  const slug = body.slug?.trim() ?? '';
  const userText = body.message?.trim() ?? '';
  if (!slug || !userText) return new Response('slug and message required', { status: 400 });
  if (userText.length > MAX_MESSAGE) return new Response(`Message is too long (max ${MAX_MESSAGE} characters)`, { status: 400 });
  const chatId = typeof body.chatId === 'string' && body.chatId.trim() ? body.chatId.trim() : null;
  if (chatId && !UUID_RE.test(chatId)) return new Response('Invalid chat id', { status: 400 });

  if (!inspectorLlmConfigured()) {
    return new Response('Using an agent requires a configured model backend (AWS Bedrock, instance profile, or xAI).', { status: 503 });
  }
  const role = await getSessionUserRole();
  // Who is chatting, so the agent searches only knowledge bases this person may see.
  const principal = await resolveInspectorPrincipal(request).catch(() => null);
  const person = principal?.kind === 'user' ? { userId: principal.userId, role: role ?? 'member' } : null;
  const resolved = resolveWorkbenchModel(body.model, role, 'commissioned_agents');
  if (!resolved) return new Response('Model not available', { status: 400 });
  const { effectiveModelId } = resolved;

  // Checked here so these keep their HTTP status; the run itself is shared with Automate.
  const agent = await prisma.agent_catalog.findFirst({ where: { slug } });
  if (!agent) return new Response('Agent not found', { status: 404 });
  if (!runtimeBriefFromCatalog(agent)) return new Response('This agent has no instructions to run.', { status: 400 });

  let history: Turn[];
  let chat: { id: string } | null = null;
  if (person) {
    if (chatId) {
      const existing = await getAgentChat(chatId);
      if (!existing) return new Response('Chat not found', { status: 404 });
      // Admins may read other people's chats (agent page → Review), but nobody writes into them.
      if (existing.user_id !== person.userId) return new Response('This chat belongs to someone else', { status: 403 });
      if (existing.agentId !== agent.id) return new Response('This chat is with a different agent', { status: 400 });
      chat = existing;
      history = historyForModel(existing.messages);
    } else {
      history = [];
    }
  } else {
    if (chatId) return new Response('Saved chats need a signed-in user', { status: 401 });
    const parsedHistory = parseHistory(body.history);
    if ('error' in parsedHistory) return new Response(parsedHistory.error, { status: 400 });
    history = parsedHistory;
  }

  // A previous turn can end on the user (stopped or empty reply). Fold it into this message
  // so the model still sees alternating roles. Only the new text is saved.
  let message = userText;
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    message = `${history[history.length - 1].content}\n\n${message}`;
    history = history.slice(0, -1);
  }

  if (person && !chat) {
    chat = await createAgentChat({ userId: person.userId, agent: { id: agent.id, slug: agent.slug ?? slug }, firstMessage: userText });
  }
  const savedChat = chat;
  const userMessage: AgentChatMessage = newChatMessage('user', userText);

  const stream = new ReadableStream({
    async start(controller) {
      // `closed` means the browser went away. The model keeps running; only Stop sets `userStop`.
      const closed = { value: false };
      const stopKey = savedChat ? turnStopKey('agent', savedChat.id) : '';
      if (stopKey) clearTurnStop(stopKey);
      const userStop = { get value() { return isTurnStopped(stopKey); } };
      const draft = createDraftWriter(savedChat?.id, 'agentDraft');
      const encoder = new TextEncoder();
      request.signal.addEventListener('abort', () => {
        closed.value = true;
      });
      const emit = (event: Record<string, unknown>) => {
        if (closed.value) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed.value = true;
        }
      };

      let reply = '';
      let finalText = '';
      let inspection: AgentInspection | null = null;
      let doneEvent: Record<string, unknown> = { type: 'done', outcome: 'errored' };
      try {
        emit({ type: 'stream_start', mode: 'agent_use', model: effectiveModelId, agent: agent.name });
        if (savedChat) emit({ type: 'chat', chatId: savedChat.id });
        const result = await runCatalogAgent({
          slug,
          message,
          history,
          role,
          model: body.model,
          surface: 'agent_use',
          sessionId: savedChat?.id,
          person,
          captureInspection: true,
          abort: userStop,
          onTextChunk: (delta) => {
            reply += delta;
            draft.append(delta);
            emit({ type: 'text', delta });
          },
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
        finalText = result.text ?? '';
        inspection = result.inspection;
        const visibleNote = messagesForViewer([{ inspection }], role)[0]?.inspection;
        if (visibleNote) emit({ type: 'inspection', inspection: visibleNote });

        if (result.outcome === 'errored' && result.errorDetail) {
          emit({ type: 'error', message: clientStreamError(result.errorDetail, 'agents/chat') });
        }
        doneEvent = {
          type: 'done',
          outcome: result.outcome,
          loops: result.loops,
          usage: result.usage,
          model: result.model,
        };
      } catch (err: unknown) {
        emit({ type: 'error', message: clientStreamError(err, 'agents/chat') });
      } finally {
        // Saved even when the person pressed Stop or the run failed, so the chat matches what they saw.
        if (savedChat) {
          const replyText = reply.trim() ? reply : finalText;
          try {
            await appendAgentChatMessages(savedChat.id, [userMessage, newChatMessage('assistant', replyText, inspection)]);
          } catch (err) {
            console.error('[agents/chat] saving the turn failed', err);
            emit({ type: 'error', message: 'This reply could not be saved to your chat history.' });
          }
        }
        const replyText = reply.trim() ? reply : finalText;
        if (replyText.trim()) draft.replace(replyText);
        emit(doneEvent);
        await draft.finish(userStop.value ? 'stopped' : doneEvent.outcome === 'errored' ? 'error' : 'done');
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
