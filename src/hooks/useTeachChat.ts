'use client';

/**
 * useTeachChat — Teach Phase 4 client state.
 *
 * A focused fork of useInspectorChat. It keeps the same SSE plumbing but points
 * at /api/inspector/teach (the Reflect loop) and, crucially, maintains a
 * normalized `learnings` map that the "What Marcus is learning" rail binds to.
 *
 * The rail is driven ONLY by typed events — never by scraping the chat text:
 *   learning_item        → UPSERT a card into `learnings` (keyed by learning.id)
 *   verification_result  → advance the matching card's state + verification chip
 *                          (bound by learning.memoryId === event.learningId)
 *   memory_recall        → attach a "recalled N memories" affordance to the turn
 *
 * UPSERT, not append: a learning transitions proposed → verifying → verified /
 * conflict / rejected via repeated events on the same id (or memoryId). Appending
 * would show a card twice, reading as "Marcus learned the same thing twice".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Learning,
  LearningState,
  RelatedMemoryHit,
  VerificationResult,
} from '@/lib/inspector/reflect-tools';
// Type-only import — erased at compile time, so this never pulls teach-feed's
// server-side prisma access into the client bundle.
import type { TeachCandidate } from '@/lib/inspector/teach-feed';
// Value import — teach-rail is client-safe (type-only imports itself).
import { projectCandidatesToRail } from '@/lib/inspector/teach-rail';

export type { Learning, LearningState, RelatedMemoryHit, VerificationResult };

/** A single turn in the Teach thread — narrative only (no cards live here). */
export interface TeachMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** e.g. "Follow-up question" / "Verifying a claim" — a colored sub-tag. */
  subTag?: string;
  /** Standalone recall_memory affordance surfaced in Marcus's bubble. */
  recall?: { query: string; count: number; hits: RelatedMemoryHit[] };
  /** An inline verification chip rendered in the bubble (mockup §5). */
  verification?: VerificationResult;
  timestamp: number;
}

/** Live counters for the session header — derived from the learnings map. */
export interface TeachCounters {
  proposed: number;
  verified: number;
  pending: number; // currently verifying
  conflicts: number;
}

interface UseTeachChatReturn {
  messages: TeachMessage[];
  learnings: Record<string, Learning>;
  /** Insertion order of learning ids, so the rail renders first-seen first. */
  learningOrder: string[];
  counters: TeachCounters;
  isStreaming: boolean;
  error: string | null;
  /** Set when a hydrate (reload of a persisted session) fails — 403 for a
   *  session the caller doesn't own, 404 for a missing/non-teach session. */
  sessionLoadError: string | null;
  sessionId: string | null;
  send: (content: string) => void;
  abort: () => void;
  reset: () => void;
  /** Client-transient conflict resolution (no governed write — commit is Build). */
  resolveLearning: (learningId: string, nextState: LearningState) => void;
}

function deriveCounters(
  learnings: Record<string, Learning>,
  order: string[],
): TeachCounters {
  const c: TeachCounters = { proposed: 0, verified: 0, pending: 0, conflicts: 0 };
  for (const id of order) {
    const l = learnings[id];
    if (!l) continue;
    switch (l.state) {
      case 'verified': c.verified++; break;
      case 'verifying': c.pending++; break;
      case 'conflict': c.conflicts++; break;
      case 'proposed': c.proposed++; break;
      // 'rejected' is intentionally not counted in any headline tile.
    }
  }
  return c;
}

export function useTeachChat(initialSessionId: string | null = null): UseTeachChatReturn {
  const [messages, setMessages] = useState<TeachMessage[]>([]);
  const [learnings, setLearnings] = useState<Record<string, Learning>>({});
  const [learningOrder, setLearningOrder] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(initialSessionId);

  const sessionIdRef = useRef<string | null>(initialSessionId);
  const abortRef = useRef<AbortController | null>(null);
  const idCounter = useRef(0);
  const nextId = () => `teach_${Date.now()}_${++idCounter.current}`;

  // Persistence plumbing (Track A retention).
  const messagesRef = useRef<TeachMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false); // unsaved message delta pending a PATCH
  const hydratedRef = useRef(false); // one-shot hydrate guard

  // ── Hydrate on mount (persisted reload) ───────────────────────────────────────
  // Reload of /agent-lab/teach/[sessionId] → replay the messages blob AND rebuild
  // the rail from the persisted candidate projection. Goes through the guarded,
  // always-enforce Teach hydrate route (deviation #1): a session the caller does
  // not own 403s rather than serving. No verify queries are re-fired (A3).
  useEffect(() => {
    if (!initialSessionId || hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;
    fetch(`/api/inspector/teach/session/${initialSessionId}`)
      .then((r) => {
        if (r.status === 403) throw new Error("You don't have access to this teaching session.");
        if (r.status === 404) throw new Error('That teaching session no longer exists.');
        if (!r.ok) throw new Error(`Session load failed (${r.status})`);
        return r.json();
      })
      .then((data: { session?: { messages?: TeachMessage[] }; feed?: { candidates?: TeachCandidate[] } }) => {
        if (cancelled) return;
        setMessages((data.session?.messages as TeachMessage[] | undefined) ?? []);

        // Rebuild the rail from the persisted candidate projection (Option A —
        // the rail is child-row state, never the message blob).
        const { learnings: map, order } = projectCandidatesToRail(data.feed?.candidates ?? []);
        setLearnings(map);
        setLearningOrder(order);

        setCurrentSessionId(initialSessionId);
        sessionIdRef.current = initialSessionId;
        setSessionLoadError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setSessionLoadError(e instanceof Error ? e.message : 'Failed to load session');
      });
    return () => { cancelled = true; };
  }, [initialSessionId]);

  // ── Autosave (2s-debounced PATCH of the messages blob) ────────────────────────
  // Mirrors useInspectorChat. The rail is NOT saved here — it is a projection of
  // platform_teach_candidate (child rows written at capture, Option A), never the
  // message blob.
  useEffect(() => {
    if (!currentSessionId) return;
    dirtyRef.current = true;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      fetch(`/api/agent-lab/workbench/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesRef.current }),
      })
        .then(() => { dirtyRef.current = false; })
        .catch(() => {});
    }, 2000);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [currentSessionId, messages]);

  // ── Flush-on-hide (deviation #3) ──────────────────────────────────────────────
  // A 2s debounce loses the last delta if the tab is closed/hidden mid-window. On
  // visibilitychange→hidden / pagehide, synchronously flush the pending write with
  // a keepalive fetch (survives unload; PATCH rules out sendBeacon, which is POST).
  useEffect(() => {
    const flush = () => {
      const sid = sessionIdRef.current;
      if (!sid || !dirtyRef.current) return;
      if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
      dirtyRef.current = false;
      try {
        fetch(`/api/agent-lab/workbench/sessions/${sid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: messagesRef.current }),
          keepalive: true,
        }).catch(() => {});
      } catch {/* unload path — best effort */}
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  /** UPSERT a learning by its id; preserve fields the event omits. */
  const upsertLearning = useCallback((learning: Learning) => {
    setLearnings((prev) => ({
      ...prev,
      [learning.id]: { ...prev[learning.id], ...learning },
    }));
    setLearningOrder((prev) => (prev.includes(learning.id) ? prev : [...prev, learning.id]));
  }, []);

  /** Patch a card found by its memoryId (verification binds by memoryId). */
  const patchByMemoryId = useCallback(
    (memoryId: string | null, patch: Partial<Learning>) => {
      if (!memoryId) return;
      setLearnings((prev) => {
        const entry = Object.values(prev).find((l) => l.memoryId === memoryId);
        if (!entry) return prev;
        return { ...prev, [entry.id]: { ...entry, ...patch } };
      });
    },
    [],
  );

  const doSend = useCallback(async (content: string, sid: string | null) => {
    const userMsg: TeachMessage = { id: nextId(), role: 'user', content, timestamp: Date.now() };
    const assistantId = nextId();
    const assistantMsg: TeachMessage = { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() };

    let history: TeachMessage[] = [];
    setMessages((prev) => {
      history = prev;
      return [...prev, userMsg, assistantMsg];
    });

    setIsStreaming(true);
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Track which verify_claim call targets which memoryId, so verifying-state
    // can be applied on tool_call_running (the running event carries the input).
    const verifyTargets: Record<string, string> = {}; // callId -> learningId
    let rawContent = '';

    try {
      const resp = await fetch('/api/inspector/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          messages: [...history, userMsg]
            .filter((m) => m.content?.trim())
            .map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        setError(`Reflect stream error (${resp.status})`);
        setIsStreaming(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const setAssistant = (patch: Partial<TeachMessage>) =>
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === assistantId);
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], ...patch };
          return next;
        });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(raw); } catch { continue; }

          switch (event.type) {
            case 'text':
              rawContent += (event.delta as string) ?? '';
              setAssistant({ content: sanitize(rawContent) });
              break;

            case 'tool_call_running': {
              const toolName = event.toolName as string;
              if (toolName === 'verify_claim') {
                const input = event.input as Record<string, unknown> | undefined;
                const learningId = typeof input?.learningId === 'string' ? input.learningId : null;
                setAssistant({ subTag: 'Verifying a claim' });
                if (learningId) {
                  verifyTargets[event.callId as string] = learningId;
                  patchByMemoryId(learningId, { state: 'verifying' });
                }
              } else if (toolName === 'recall_memory') {
                setAssistant({ subTag: 'Recalling memory' });
              }
              break;
            }

            case 'learning_item':
              upsertLearning(event.learning as Learning);
              break;

            case 'memory_recall':
              setAssistant({
                recall: {
                  query: (event.query as string) ?? '',
                  count: (event.count as number) ?? 0,
                  hits: (event.hits as RelatedMemoryHit[]) ?? [],
                },
              });
              break;

            case 'verification_result': {
              const result = event.result as VerificationResult;
              const learningState = (event.learningState as LearningState) ?? 'proposed';
              const learningId =
                (typeof event.learningId === 'string' ? event.learningId : null) ??
                verifyTargets[event.callId as string] ??
                null;
              // Rail card: bind by memoryId and advance its state + chip.
              patchByMemoryId(learningId, { verification_result: result, state: learningState });
              // Thread: also surface the inline verification chip (mockup §5).
              setAssistant({ verification: result });
              break;
            }

            case 'error':
              setError((event.message as string) ?? 'Reflect stream failed');
              break;

            case 'done':
              // Clear any lingering "verifying" sub-tag on the turn.
              setAssistant({ subTag: undefined });
              break;
          }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Reflect stream failed');
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [patchByMemoryId, upsertLearning]);

  const send = useCallback((content: string) => {
    const text = content.trim();
    if (!text) return;
    setError(null);

    const sid = sessionIdRef.current;
    if (sid) { void doSend(text, sid); return; }

    // No session yet — create one (mirrors useInspectorChat), then send.
    fetch('/api/inspector/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: text.slice(0, 80), surface: 'teach' }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { session: { id: string } }) => {
        const id = data.session.id;
        setCurrentSessionId(id);
        sessionIdRef.current = id;
        // Swap the URL to the durable per-session route WITHOUT remounting (a
        // router.push would re-run the server component and blow away this state).
        // A reload now lands on /agent-lab/teach/[id] and hydrates.
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `/agent-lab/teach/${id}`);
        }
        void doSend(text, id);
      })
      .catch(() => { void doSend(text, null); }); // fall through session-less
  }, [doSend]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    dirtyRef.current = false;
    setMessages([]);
    setLearnings({});
    setLearningOrder([]);
    setError(null);
    setSessionLoadError(null);
    setIsStreaming(false);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    idCounter.current = 0;
  }, []);

  const resolveLearning = useCallback((learningId: string, nextState: LearningState) => {
    setLearnings((prev) => {
      const l = prev[learningId];
      if (!l) return prev;
      return { ...prev, [learningId]: { ...l, state: nextState } };
    });
  }, []);

  return {
    messages,
    learnings,
    learningOrder,
    counters: deriveCounters(learnings, learningOrder),
    isStreaming,
    error,
    sessionLoadError,
    sessionId: currentSessionId,
    send,
    abort,
    reset,
    resolveLearning,
  };
}

/** Strip the loop's control markup from streamed narrative (mirrors inspector). */
function sanitize(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?thinking>/gi, '')
    .replace(/<query_result>[\s\S]*?<\/query_result>/gi, '')
    .trim();
}
