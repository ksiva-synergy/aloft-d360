'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbenchMessage } from '@/components/agent-lab/workbench/types';
import { AVAILABLE_MODELS } from '@/components/agent-lab/workbench/types';
import type { ConstructionState } from '@/lib/construction/constructionState';
import type { AssumptionLedgerEntry } from '@/lib/construction/assumptionHelpers';
import { confirmAssumption, correctAssumption } from '@/lib/construction/assumptionHelpers';
import { constructionStateSchema } from '@/lib/construction/constructionState';
import { applyConstructionPatch } from '@/lib/construction/apply-patch';
import { coerceConstructionState } from '@/lib/construction/load-state';
import { deriveReadiness } from '@/lib/construction/readiness';
import { emptyConstructionDraft } from '@/lib/construction/empty-draft';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';

const DEFAULT_MODEL = DEFAULT_INSPECTOR_MODEL_KEY;

interface UseWorkbenchChatOptions {
  sessionId: string | null;
  onSessionCreated?: (id: string) => void;
}

export function useWorkbenchChat({ sessionId, onSessionCreated }: UseWorkbenchChatOptions) {
  const [localMessages, setLocalMessages] = useState<WorkbenchMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [completionMeta, setCompletionMeta] = useState<
    Record<string, { durationMs: number; tokenCount: number; modelName: string }>
  >({});
  const [previewModel, setPreviewModel] = useState(DEFAULT_MODEL);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const [constructionState, setConstructionState] = useState<ConstructionState | null>(null);
  const [readiness, setReadiness] = useState<'interview' | 'plan' | 'build' | 'validate' | 'commission' | null>(null);
  const [classSuggestion, setClassSuggestion] = useState<{
    classId: string;
    confidence: number;
    rationale: string;
  } | null>(null);
  const [attachedToolIds, setAttachedToolIds] = useState<string[]>([]);
  const [isCommissioning, setIsCommissioning] = useState(false);
  const [commissionResult, setCommissionResult] = useState<{ catalogUrl: string } | null>(null);

  const sessionIdRef = useRef<string | null>(sessionId);
  const modelRef = useRef(previewModel);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamStartRef = useRef<number | null>(null);
  const constructionHydratedRef = useRef<string | null>(null);

  useEffect(() => { modelRef.current = previewModel; }, [previewModel]);
  useEffect(() => { sessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => {
    if (sessionId) setCurrentSessionId(sessionId);
  }, [sessionId]);

  let msgIdCounter = 0;
  function nextMsgId(): string {
    return `wb_${Date.now()}_${++msgIdCounter}`;
  }

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/agent-lab/workbench/sessions/${sessionId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Session load failed: ${r.status}`);
        return r.json();
      })
      .then((data: {
        session?: {
          id: string;
          messages?: WorkbenchMessage[];
          constructionState?: ConstructionState | null;
          readiness?: string | null;
          attachedTools?: string[];
          progress?: { last_model?: string };
        };
      }) => {
        if (!data?.session) {
          setSessionLoadError(`Session not found (id: ${sessionId})`);
          return;
        }
        const s = data.session;
        setLocalMessages(s.messages || []);
        setConstructionState(s.constructionState ?? emptyConstructionDraft());
        if (s.readiness) setReadiness(s.readiness as typeof readiness);
        constructionHydratedRef.current = s.id;
        setAttachedToolIds(s.attachedTools ?? []);
        if (s.progress?.last_model && AVAILABLE_MODELS.some((m) => m.key === s.progress!.last_model)) {
          setPreviewModel(s.progress.last_model as string);
        }
        setCurrentSessionId(s.id);
        setSessionLoadError(null);
      })
      .catch((err: unknown) => {
        setSessionLoadError(err instanceof Error ? err.message : 'Failed to load session');
      });
  }, [sessionId]);

  useEffect(() => {
    if (!currentSessionId) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      fetch(`/api/agent-lab/workbench/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: localMessages,
          last_model: modelRef.current,
          attached_tools: attachedToolIds,
          ...(constructionState ? { construction_state: constructionState } : {}),
        }),
      }).catch(() => {});
    }, 2000);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [currentSessionId, localMessages, constructionState, attachedToolIds]);

  const syncSessionConstruction = useCallback((sid: string) => {
    fetch(`/api/agent-lab/workbench/sessions/${sid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { session?: { constructionState?: ConstructionState | null; readiness?: string | null } } | null) => {
        const cs = data?.session?.constructionState ?? emptyConstructionDraft();
        setConstructionState(cs);
        setReadiness((cs.readiness ?? data?.session?.readiness ?? null) as typeof readiness);
        constructionHydratedRef.current = sid;
      })
      .catch(() => {});
  }, []);

  /** URL uses replaceState after create — page prop sessionId stays null; pull draft from API once. */
  useEffect(() => {
    if (!currentSessionId) return;
    if (constructionHydratedRef.current === currentSessionId) return;
    if (sessionId && sessionId === currentSessionId) return;
    syncSessionConstruction(currentSessionId);
  }, [currentSessionId, sessionId, syncSessionConstruction]);

  const persistConstruction = useCallback((next: ConstructionState) => {
    setConstructionState(next);
    setReadiness(next.readiness);
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch(`/api/agent-lab/workbench/sessions/${sid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ construction_state: next }),
    }).catch(() => {});
  }, []);

  const doSend = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const sid = sessionIdRef.current;
    if (!sid) return;

    const userMsgId = nextMsgId();
    const assistantMsgId = nextMsgId();
    const now = Date.now();

    const userMsg: WorkbenchMessage = { id: userMsgId, role: 'user', content: trimmed, timestamp: now, turnNumber: 0 };
    const assistantMsg: WorkbenchMessage = { id: assistantMsgId, role: 'assistant', content: '', timestamp: now, turnNumber: 0 };

    setLocalMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    setInterrupted(false);
    setSuggestions([]);
    setClassSuggestion(null);
    streamStartRef.current = Date.now();

    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    try {
      const allMessages = await new Promise<WorkbenchMessage[]>((resolve) => {
        setLocalMessages((prev) => {
          resolve(prev);
          return prev;
        });
      });

      const resp = await fetch('/api/agent-lab/workbench/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          messages: [...allMessages.filter((m) => m.id !== assistantMsgId), userMsg],
          model: modelRef.current,
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => '');
        setError(errText || `Chat failed (${resp.status}). Check model/AWS config or try another model.`);
        setLocalMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
        setIsStreaming(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let rawContent = '';

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
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

          switch (event.type) {
            case 'text':
              rawContent += event.delta as string;
              setLocalMessages((prev) => {
                const updated = [...prev];
                const idx = updated.findIndex((m) => m.id === assistantMsgId);
                if (idx >= 0) updated[idx] = { ...updated[idx], content: rawContent };
                return updated;
              });
              break;
            case 'suggestions':
              if (Array.isArray(event.items)) setSuggestions(event.items as string[]);
              break;
            case 'class_suggestion':
              setClassSuggestion({
                classId: String(event.classId),
                confidence: Number(event.confidence),
                rationale: String(event.rationale),
              });
              break;
            case 'readiness':
              if (typeof event.value === 'string') setReadiness(event.value as typeof readiness);
              break;
            case 'agent_construction_patch':
              setConstructionState((prev) => {
                try {
                  const field = String(event.field);
                  const value = event.value;
                  const source = (event.source as 'ai' | 'user' | 'template') ?? 'ai';
                  const base =
                    prev ??
                    constructionStateSchema.parse({
                      memory: { buildContext: { orgId: 'local-draft' } },
                    });
                  let next = applyConstructionPatch(base, field, value, source);
                  next = coerceConstructionState({ ...next, readiness: deriveReadiness(next) });
                  setReadiness(next.readiness);
                  return next;
                } catch {
                  return prev;
                }
              });
              break;
            case 'construction_state': {
              const raw = event.state;
              const parsed = constructionStateSchema.safeParse(raw);
              if (parsed.success) {
                setConstructionState(parsed.data);
                setReadiness(parsed.data.readiness);
              }
              break;
            }
            case 'done': {
              syncSessionConstruction(sid);
              const started = streamStartRef.current;
              const durationMs = started ? Date.now() - started : 0;
              const usage = event.usage as { inputTokens?: number; outputTokens?: number } | undefined;
              const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
              setCompletionMeta((prev) => ({
                ...prev,
                [assistantMsgId]: {
                  durationMs,
                  tokenCount: tokens,
                  modelName: String(event.model ?? modelRef.current),
                },
              }));
              if (event.outcome === 'errored' && tokens === 0) {
                setError((prev) => prev ?? 'Model request failed. Try Claude Sonnet 5.5 or check XAI_API_KEY / AWS credentials.');
              }
              break;
            }
            case 'error':
              setError(String(event.message));
              break;
            default:
              break;
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setInterrupted(true);
      } else {
        setError(err instanceof Error ? err.message : 'Stream failed');
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [syncSessionConstruction]);

  const createSessionAndSend = useCallback(
    (content: string) => {
      fetch('/api/agent-lab/workbench/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: content.slice(0, 80),
          surface: 'workbench',
          messages: [],
        }),
      })
        .then(async (r) => {
          const data = (await r.json()) as {
            session?: { id: string; construction_state?: unknown };
            error?: string;
          };
          if (!r.ok || !data.session?.id) {
            throw new Error(data.error ?? `Could not create session (${r.status})`);
          }
          return data.session;
        })
        .then((session) => {
          const id = session.id;
          setCurrentSessionId(id);
          sessionIdRef.current = id;
          const parsed = constructionStateSchema.safeParse(session.construction_state);
          if (parsed.success) {
            setConstructionState(parsed.data);
            setReadiness(parsed.data.readiness);
            constructionHydratedRef.current = id;
          }
          // Update URL without Next.js navigation (router.replace remounts and kills the stream).
          onSessionCreated?.(id);
          return doSend(content);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to create session');
        });
    },
    [doSend, onSessionCreated],
  );

  const send = useCallback(
    (content: string) => {
      setError(null);
      setInterrupted(false);
      if (!currentSessionId) {
        createSessionAndSend(content);
        return;
      }
      doSend(content);
    },
    [currentSessionId, createSessionAndSend, doSend],
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setInterrupted(true);
  }, []);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setLocalMessages([]);
    setConstructionState(null);
    setReadiness(null);
    setClassSuggestion(null);
    setCommissionResult(null);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setError(null);
    setSuggestions([]);
    setInterrupted(false);
    setIsStreaming(false);
  }, []);

  const editMessage = useCallback(
    (messageId: string): { content: string } | null => {
      const idx = localMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return null;
      const msg = localMessages[idx];
      if (msg.role !== 'user') return null;
      setLocalMessages(localMessages.slice(0, idx));
      return { content: msg.content };
    },
    [localMessages],
  );

  const commission = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCommissioning) return;
    setIsCommissioning(true);
    setError(null);
    try {
      const res = await fetch('/api/agent-lab/workbench/commission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      });
      const data = (await res.json()) as { error?: string; catalogUrl?: string };
      if (!res.ok) {
        setError(data.error ?? `Commission failed (${res.status})`);
        return;
      }
      if (data.catalogUrl) setCommissionResult({ catalogUrl: data.catalogUrl });
      setReadiness('commission');
    } catch {
      setError('Commission request failed');
    } finally {
      setIsCommissioning(false);
    }
  }, [isCommissioning]);

  const assumptionLedger: AssumptionLedgerEntry[] = constructionState?.assumptionLedger ?? [];

  const onConfirmAssumption = useCallback(
    (field: string) => {
      if (!constructionState) return;
      persistConstruction(confirmAssumption(constructionState, field));
    },
    [constructionState, persistConstruction],
  );

  const onEditAssumption = useCallback(
    (field: string, newValue: string) => {
      if (!constructionState) return;
      persistConstruction(correctAssumption(constructionState, field, newValue));
    },
    [constructionState, persistConstruction],
  );

  const onApplyClass = useCallback(
    (_updatedClass: unknown, updatedMemory: unknown) => {
      if (!constructionState) return;
      persistConstruction({
        ...constructionState,
        class: _updatedClass as ConstructionState['class'],
        memory: updatedMemory as ConstructionState['memory'],
      });
    },
    [constructionState, persistConstruction],
  );

  return {
    messages: localMessages,
    isStreaming,
    error,
    sessionLoadError,
    suggestions,
    selectedModel: previewModel,
    setSelectedModel: setPreviewModel,
    interrupted,
    completionMeta,
    sessionId: currentSessionId,
    constructionState,
    readiness,
    classSuggestion,
    setClassSuggestion,
    attachedToolIds,
    setAttachedToolIds,
    isCommissioning,
    commissionResult,
    send,
    abort,
    reset,
    editMessage,
    commission,
    assumptionLedger,
    onConfirmAssumption,
    onEditAssumption,
    onApplyClass,
  };
}
