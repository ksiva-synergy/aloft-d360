import type { ToolCall } from '@/components/agent-lab/workbench/types';

export type AgentUseChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

export const AGENT_USE_STORAGE_LIMIT = 80_000;

export function agentUseStorageKey(slug: string) {
  return `aloft.agentUse.${slug}`;
}

export function loadAgentUseMessages(slug: string): AgentUseChatMessage[] {
  try {
    const raw = sessionStorage.getItem(agentUseStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;
      const id = (item as { id?: unknown }).id;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return [];
      return [{ id: typeof id === 'string' ? id : crypto.randomUUID(), role, content }];
    });
  } catch {
    return [];
  }
}

export function persistAgentUseMessages(slug: string, messages: AgentUseChatMessage[]) {
  try {
    const payload = JSON.stringify(messages);
    if (payload.length <= AGENT_USE_STORAGE_LIMIT) {
      sessionStorage.setItem(agentUseStorageKey(slug), payload);
    }
  } catch {
    /* private mode */
  }
}

export type AgentUseChatSnapshot = {
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
  messages: AgentUseChatMessage[];
  runError: string | null;
  toolCalls: ToolCall[];
  startedAt: number;
};

const inFlightBySlug = new Map<string, InFlight>();
/** UI subscribers (mounted chat pages) — separate from in-flight handles so the first send is not silent. */
const listenersBySlug = new Map<string, Set<Listener>>();

function snapshot(slug: string): AgentUseChatSnapshot {
  const handle = inFlightBySlug.get(slug);
  if (!handle) {
    return { messages: loadAgentUseMessages(slug), running: false, runError: null, toolCalls: [], startedAt: null };
  }
  return {
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

function publish(slug: string) {
  const handle = inFlightBySlug.get(slug);
  if (handle) persistAgentUseMessages(slug, handle.messages);
  notifyListeners(slug);
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

/** Abort any in-flight stream and drop its partial reply (used by New chat). */
export function resetAgentUseChat(slug: string) {
  const handle = inFlightBySlug.get(slug);
  if (handle) {
    inFlightBySlug.delete(slug);
    handle.ctrl.abort();
  }
  persistAgentUseMessages(slug, []);
  notifyListeners(slug);
}

export function startAgentUseChat(input: {
  slug: string;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  priorMessages: AgentUseChatMessage[];
  model?: string;
}): void {
  const { slug, message, history, priorMessages, model } = input;
  inFlightBySlug.get(slug)?.ctrl.abort();

  const userMsg: AgentUseChatMessage = { id: crypto.randomUUID(), role: 'user', content: message };
  const assistantId = crypto.randomUUID();
  const ctrl = new AbortController();
  const handle: InFlight = {
    ctrl,
    assistantId,
    messages: [...priorMessages, userMsg, { id: assistantId, role: 'assistant', content: '' }],
    runError: null,
    toolCalls: [],
    startedAt: Date.now(),
  };
  inFlightBySlug.set(slug, handle);
  publish(slug);

  void (async () => {
    try {
      const res = await fetch('/api/agent-lab/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, message, history, model }),
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
          if (ev.type === 'text') {
            const delta = String(ev.delta ?? '');
            handle.messages = handle.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m,
            );
            publish(slug);
          } else if (ev.type === 'tool_call_running') {
            const callId = String(ev.callId ?? crypto.randomUUID());
            const toolName = String(ev.toolName ?? 'a tool');
            handle.toolCalls = [
              ...handle.toolCalls.filter((t) => t.callId !== callId),
              { callId, toolId: toolName, toolName, status: 'running', input: ev.input },
            ];
            publish(slug);
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
            publish(slug);
          } else if (ev.type === 'error') {
            handle.runError = String(ev.message ?? 'The agent hit an error');
            publish(slug);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        handle.runError = err instanceof Error ? err.message : 'The request failed';
        publish(slug);
      }
    } finally {
      handle.messages = handle.messages.filter(
        (m) => m.role !== 'assistant' || m.content.trim() || m.id !== assistantId,
      );
      const stillCurrent = inFlightBySlug.get(slug) === handle;
      if (!stillCurrent) return;
      inFlightBySlug.delete(slug);
      persistAgentUseMessages(slug, handle.messages);
      notifyListeners(slug);
    }
  })();
}
