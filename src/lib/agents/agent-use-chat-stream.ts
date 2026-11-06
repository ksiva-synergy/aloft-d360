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
  assistantId: string;
  chatId: string | null;
  messages: AgentUseChatMessage[];
  runError: string | null;
  toolCalls: ToolCall[];
  startedAt: number;
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

function notifyListeners(slug: string) {
  const snap = snapshot(slug);
  for (const listener of listenersBySlug.get(slug) ?? []) listener(snap);
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

export function stopAgentUseChat(slug: string) {
  inFlightBySlug.get(slug)?.ctrl.abort();
}

/** Show a saved chat (loaded from the server). Ignored while a reply is streaming. */
export function openAgentUseChat(slug: string, chatId: string, messages: AgentUseChatMessage[]) {
  if (inFlightBySlug.has(slug)) return;
  idleBySlug.set(slug, { chatId, messages, runError: null });
  notifyListeners(slug);
}

/**
 * Start a new, empty chat (used by New chat). An in-flight reply is stopped; the server still
 * saves what it had, so it stays in the person's chat list.
 */
export function resetAgentUseChat(slug: string) {
  const handle = inFlightBySlug.get(slug);
  if (handle) {
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
  const { slug, chatId, message, priorMessages, model, onSettled } = input;
  inFlightBySlug.get(slug)?.ctrl.abort();

  const userMsg: AgentUseChatMessage = { id: crypto.randomUUID(), role: 'user', content: message };
  const assistantId = crypto.randomUUID();
  const ctrl = new AbortController();
  const handle: InFlight = {
    ctrl,
    assistantId,
    chatId,
    messages: [...priorMessages, userMsg, { id: assistantId, role: 'assistant', content: '' }],
    runError: null,
    toolCalls: [],
    startedAt: Date.now(),
  };
  inFlightBySlug.set(slug, handle);
  notifyListeners(slug);

  void (async () => {
    try {
      const res = await fetch('/api/agent-lab/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, message, chatId, model }),
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
            notifyListeners(slug);
          } else if (ev.type === 'inspection') {
            const note = parseInspection(ev.inspection);
            if (note) {
              handle.messages = handle.messages.map((m) =>
                m.id === assistantId ? { ...m, inspection: note } : m,
              );
              notifyListeners(slug);
            }
          } else if (ev.type === 'text') {
            const delta = String(ev.delta ?? '');
            handle.messages = handle.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m,
            );
            notifyListeners(slug);
          } else if (ev.type === 'tool_call_running') {
            const callId = String(ev.callId ?? crypto.randomUUID());
            const toolName = String(ev.toolName ?? 'a tool');
            handle.toolCalls = [
              ...handle.toolCalls.filter((t) => t.callId !== callId),
              { callId, toolId: toolName, toolName, status: 'running', input: ev.input },
            ];
            notifyListeners(slug);
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
            notifyListeners(slug);
          } else if (ev.type === 'error') {
            handle.runError = String(ev.message ?? 'The agent hit an error');
            notifyListeners(slug);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        handle.runError = err instanceof Error ? err.message : 'The request failed';
        notifyListeners(slug);
      }
    } finally {
      handle.messages = handle.messages.filter(
        (m) => m.role !== 'assistant' || m.content.trim() || m.id !== assistantId,
      );
      const stillCurrent = inFlightBySlug.get(slug) === handle;
      if (stillCurrent) {
        inFlightBySlug.delete(slug);
        idleBySlug.set(slug, { chatId: handle.chatId, messages: handle.messages, runError: handle.runError });
        notifyListeners(slug);
      }
      onSettled?.(handle.chatId);
    }
  })();
}
