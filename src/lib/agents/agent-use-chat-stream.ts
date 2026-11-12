import type { ToolCall } from '@/components/agent-lab/workbench/types';
import { parseInspection, type AgentInspection } from '@/lib/agents/inspection';

/**
 * Client state for Agents → Use. Chats are saved on the server (one private conversation per
 * person, see src/lib/agents/agent-chats.ts); this module only keeps the open chat in memory and
 * the in-flight stream alive while the person navigates elsewhere in the app.
 */

export type AgentUseChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Set only when the server sent one. Members never receive it. */
  inspection?: AgentInspection;
  /** The person stopped this reply before it finished. Shown in this browser only. */
  stopped?: boolean;
};

export type AgentUseChatSnapshot = {
  /** Saved chat id; null for a new chat until the server creates it on the first send. */
  chatId: string | null;
  messages: AgentUseChatMessage[];
  running: boolean;
  runError: string | null;
  /** Tool calls of the in-flight reply — live only, never persisted. */
  toolCalls: ToolCall[];
  /** Epoch ms when the in-flight reply started; null when idle. */
  startedAt: number | null;
};

type Listener = (snapshot: AgentUseChatSnapshot) => void;

type InFlight = {
  ctrl: AbortController;
  /**
   * Client id for this turn, sent with Stop so only this reply is cancelled. Missing for a reply
   * resumed after a page reload; Stop then targets the chat's current turn.
   */
  turnId?: string;
  assistantId: string;
  chatId: string | null;
  messages: AgentUseChatMessage[];
  runError: string | null;
  toolCalls: ToolCall[];
  startedAt: number;
  /** Stop button or New chat. A dropped connection leaves this false so the turn keeps going. */
  userStop: boolean;
};

type Idle = { chatId: string | null; messages: AgentUseChatMessage[]; runError: string | null };

const inFlightBySlug = new Map<string, InFlight>();
/** The open chat per agent when nothing is streaming (kept in memory for in-app navigation). */
const idleBySlug = new Map<string, Idle>();
/** UI subscribers (mounted chat pages) — separate from in-flight handles so the first send is not silent. */
const listenersBySlug = new Map<string, Set<Listener>>();

function snapshot(slug: string): AgentUseChatSnapshot {
  const handle = inFlightBySlug.get(slug);
  if (!handle) {
    const idle = idleBySlug.get(slug);
    return {
      chatId: idle?.chatId ?? null,
      messages: idle?.messages ?? [],
      running: false,
      runError: idle?.runError ?? null,
      toolCalls: [],
      startedAt: null,
    };
  }
  return {
    chatId: handle.chatId,
    messages: handle.messages,
    running: true,
    runError: handle.runError,
    toolCalls: handle.toolCalls,
    startedAt: handle.startedAt,
  };
}

/** Coalesce rapid text SSE deltas so large replies do not re-render markdown on every token. */
const TEXT_NOTIFY_MS = 80;
const textNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

function notifyListeners(slug: string) {
  const snap = snapshot(slug);
  for (const listener of listenersBySlug.get(slug) ?? []) listener(snap);
}

function flushTextNotify(slug: string) {
  const pending = textNotifyTimers.get(slug);
  if (pending) {
    clearTimeout(pending);
    textNotifyTimers.delete(slug);
  }
}

function notifyListenersNow(slug: string) {
  flushTextNotify(slug);
  notifyListeners(slug);
}

function scheduleTextNotify(slug: string) {
  if (textNotifyTimers.has(slug)) return;
  textNotifyTimers.set(
    slug,
    setTimeout(() => {
      textNotifyTimers.delete(slug);
      notifyListeners(slug);
    }, TEXT_NOTIFY_MS),
  );
}

export function getAgentUseChatSnapshot(slug: string): AgentUseChatSnapshot {
  return snapshot(slug);
}

export function isAgentUseChatRunning(slug: string): boolean {
  return inFlightBySlug.has(slug);
}

export function subscribeAgentUseChat(slug: string, listener: Listener): () => void {
  let set = listenersBySlug.get(slug);
  if (!set) {
    set = new Set();
    listenersBySlug.set(slug, set);
  }
  set.add(listener);
  listener(snapshot(slug));
  return () => {
    listenersBySlug.get(slug)?.delete(listener);
  };
}

/** Stop the reply on the server too, mark it stopped, and drop the local stream. */
function stopHandle(handle: InFlight) {
  if (handle.ctrl.signal.aborted) return;
  handle.userStop = true;
  if (handle.chatId) {
    void fetch('/api/agent-lab/agents/chat/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: handle.chatId, turnId: handle.turnId }),
    }).catch(() => {});
  }
  handle.messages = handle.messages.map((m) =>
    m.id === handle.assistantId ? { ...m, stopped: true } : m,
  );
  handle.ctrl.abort();
}

export function stopAgentUseChat(slug: string) {
  const handle = inFlightBySlug.get(slug);
  if (!handle) return;
  stopHandle(handle);
  notifyListenersNow(slug);
}

/** Show a saved chat (loaded from the server). Ignored while a reply is streaming. */
export function openAgentUseChat(slug: string, chatId: string, messages: AgentUseChatMessage[]) {
  if (inFlightBySlug.has(slug)) return;
  idleBySlug.set(slug, { chatId, messages, runError: null });
  notifyListeners(slug);
}

/**
 * Page reload while the server is still generating: poll the saved chat until the draft finishes.
 */
export function resumeAgentUseChat(slug: string, chatId: string, messages: AgentUseChatMessage[]) {
  if (inFlightBySlug.has(slug)) return;
  const last = messages[messages.length - 1];
  const assistantId = last?.role === 'assistant' ? last.id : crypto.randomUUID();
  const normalized =
    last?.role === 'assistant'
      ? messages
      : [...messages, { id: assistantId, role: 'assistant' as const, content: '' }];
  const handle: InFlight = {
    ctrl: new AbortController(),
    assistantId,
    chatId,
    messages: normalized,
    runError: null,
    toolCalls: [],
    startedAt: Date.now(),
    userStop: false,
  };
  inFlightBySlug.set(slug, handle);
  notifyListenersNow(slug);
  void followDroppedAgentTurn(slug, handle);
}

/**
 * Start a new, empty chat (used by New chat). An in-flight reply is stopped; the server still
 * saves what it had, so it stays in the person's chat list.
 */
export function resetAgentUseChat(slug: string) {
  const handle = inFlightBySlug.get(slug);
  if (handle) {
    handle.userStop = true;
    inFlightBySlug.delete(slug);
    handle.ctrl.abort();
  }
  idleBySlug.set(slug, { chatId: null, messages: [], runError: null });
  notifyListeners(slug);
}

export function startAgentUseChat(input: {
  slug: string;
  /** Saved chat to continue; null starts a new one. */
  chatId: string | null;
  message: string;
  priorMessages: AgentUseChatMessage[];
  model?: string;
  /** Called once the turn is saved (or failed), e.g. to refresh the chat list. */
  onSettled?: (chatId: string | null) => void;
}): void {
  const { slug, message, model, onSettled } = input;
  let { chatId, priorMessages } = input;
  // "Send now" while a reply streams: stop it on the server as well (the server waits for it
  // to save before reading this turn's history) and keep its partial text, marked stopped.
  const previous = inFlightBySlug.get(slug);
  if (previous) {
    stopHandle(previous);
    chatId = chatId ?? previous.chatId;
    priorMessages = previous.messages.filter(
      (m) => m.id !== previous.assistantId || m.content.trim(),
    );
  }

  const userMsg: AgentUseChatMessage = { id: crypto.randomUUID(), role: 'user', content: message };
  const assistantId = crypto.randomUUID();
  const turnId = crypto.randomUUID();
  const ctrl = new AbortController();
  const handle: InFlight = {
    ctrl,
    turnId,
    assistantId,
    chatId,
    messages: [...priorMessages, userMsg, { id: assistantId, role: 'assistant', content: '' }],
    runError: null,
    toolCalls: [],
    startedAt: Date.now(),
    userStop: false,
  };
  inFlightBySlug.set(slug, handle);
  notifyListeners(slug);

  void (async () => {
    let following = false;
    try {
      const res = await fetch('/api/agent-lab/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, message, chatId, model, turnId }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(detail || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === 'chat' && typeof ev.chatId === 'string') {
            handle.chatId = ev.chatId;
            notifyListenersNow(slug);
          } else if (ev.type === 'inspection') {
            const note = parseInspection(ev.inspection);
            if (note) {
              handle.messages = handle.messages.map((m) =>
                m.id === assistantId ? { ...m, inspection: note } : m,
              );
              notifyListenersNow(slug);
            }
          } else if (ev.type === 'text') {
            const delta = String(ev.delta ?? '');
            handle.messages = handle.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m,
            );
            scheduleTextNotify(slug);
          } else if (ev.type === 'tool_call_running') {
            const callId = String(ev.callId ?? crypto.randomUUID());
            const toolName = String(ev.toolName ?? 'a tool');
            handle.toolCalls = [
              ...handle.toolCalls.filter((t) => t.callId !== callId),
              { callId, toolId: toolName, toolName, status: 'running', input: ev.input },
            ];
            notifyListenersNow(slug);
          } else if (ev.type === 'tool_call_result' || ev.type === 'tool_call_error') {
            const failed = ev.type === 'tool_call_error';
            handle.toolCalls = handle.toolCalls.map((t) =>
              t.callId === ev.callId
                ? {
                    ...t,
                    status: failed ? 'error' : 'success',
                    durationMs: typeof ev.durationMs === 'number' ? ev.durationMs : undefined,
                    error: failed ? String(ev.error ?? 'Tool failed') : undefined,
                  }
                : t,
            );
            notifyListenersNow(slug);
          } else if (ev.type === 'error') {
            handle.runError = String(ev.message ?? 'The agent hit an error');
            notifyListenersNow(slug);
          }
        }
      }
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      const dropped = !handle.userStop && (name === 'AbortError' || err instanceof TypeError);
      if (!dropped && name !== 'AbortError') {
        handle.runError = err instanceof Error ? err.message : 'The request failed';
        notifyListenersNow(slug);
      }
      if (dropped && handle.chatId) {
        following = true;
        void followDroppedAgentTurn(slug, handle, onSettled);
        return;
      }
    } finally {
      if (following) return;
      if (inFlightBySlug.get(slug) !== handle) return;
      settleAgentTurn(slug, handle, onSettled);
    }
  })();
}

function settleAgentTurn(slug: string, handle: InFlight, onSettled?: (chatId: string | null) => void) {
  handle.messages = handle.messages.filter(
    (m) => m.role !== 'assistant' || m.content.trim() || m.id !== handle.assistantId,
  );
  if (inFlightBySlug.get(slug) === handle) {
    inFlightBySlug.delete(slug);
    idleBySlug.set(slug, { chatId: handle.chatId, messages: handle.messages, runError: handle.runError });
    notifyListenersNow(slug);
  }
  onSettled?.(handle.chatId);
}

/** Browser dropped the socket. The server keeps writing; pull the draft until the turn ends. */
async function followDroppedAgentTurn(slug: string, handle: InFlight, onSettled?: (chatId: string | null) => void) {
  try {
    for (let i = 0; i < 160 && !handle.userStop; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (handle.userStop || !handle.chatId) break;
      const res = await fetch(`/api/agent-lab/agents/chats/${handle.chatId}`);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        chat?: {
          messages?: AgentUseChatMessage[];
          draft?: { status?: string; text?: string } | null;
        };
      };
      const draft = data.chat?.draft;
      if (draft && typeof draft.text === 'string' && draft.text) {
        handle.messages = handle.messages.map((m) =>
          m.id === handle.assistantId ? { ...m, content: draft.text as string } : m,
        );
        notifyListenersNow(slug);
      }
      if (!draft || draft.status !== 'running') {
        const saved = data.chat?.messages;
        if (Array.isArray(saved) && saved.length > 0) {
          handle.messages = saved;
          notifyListenersNow(slug);
        }
        break;
      }
    }
  } catch {
    /* the saved chat still has the reply when the turn finishes */
  } finally {
    settleAgentTurn(slug, handle, onSettled);
  }
}
