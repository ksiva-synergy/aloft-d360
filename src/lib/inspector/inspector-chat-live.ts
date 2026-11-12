'use client';

import type { WorkbenchMessage } from '@/components/agent-lab/workbench/types';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';
import type {
  DisambiguationMessage,
  ExportReadyMessage,
  QueryProgress,
  QueryResult,
  RunMetric,
  SemanticChartMessage,
} from '@/hooks/useInspectorChat';

type CompletionMeta = Record<string, { durationMs: number; tokenCount: number; modelName: string }>;

export type InspectorLiveSnapshot = {
  messages: WorkbenchMessage[];
  isStreaming: boolean;
  interrupted: boolean;
  suggestions: string[];
  error: string | null;
  sessionLoadError: string | null;
  completionMeta: CompletionMeta;
  runMetrics: Record<string, RunMetric>;
  sessionId: string | null;
  queryResults: QueryResult[];
  semanticChartMessages: SemanticChartMessage[];
  disambiguations: DisambiguationMessage[];
  exportOffers: ExportReadyMessage[];
  queryProgress: QueryProgress | null;
  selectedModel: string;
  /** The browser dropped the stream; the server is still writing and we are polling. */
  recovering: boolean;
};

type SetState<T> = T | ((prev: T) => T);

export type InspectorSetters = {
  setLocalMessages: (action: SetState<WorkbenchMessage[]>) => void;
  setIsStreaming: (action: SetState<boolean>) => void;
  setInterrupted: (action: SetState<boolean>) => void;
  setSuggestions: (action: SetState<string[]>) => void;
  setError: (action: SetState<string | null>) => void;
  setSessionLoadError: (action: SetState<string | null>) => void;
  setCompletionMeta: (action: SetState<CompletionMeta>) => void;
  setRunMetrics: (action: SetState<Record<string, RunMetric>>) => void;
  setCurrentSessionId: (action: SetState<string | null>) => void;
  setQueryResults: (action: SetState<QueryResult[]>) => void;
  setSemanticChartMessages: (action: SetState<SemanticChartMessage[]>) => void;
  setDisambiguations: (action: SetState<DisambiguationMessage[]>) => void;
  setExportOffers: (action: SetState<ExportReadyMessage[]>) => void;
  setQueryProgress: (action: SetState<QueryProgress | null>) => void;
  setPreviewModel: (action: SetState<string>) => void;
};

type Bucket = {
  snap: InspectorLiveSnapshot;
  listeners: Set<() => void>;
  setters: InspectorSetters;
  ctrl: AbortController | null;
  /** Client id of the running turn, sent with Stop so only that reply is cancelled. */
  turnId: string | null;
  /** Assistant message the running turn writes into. */
  assistantId: string | null;
  userStop: boolean;
  model: string;
  autosave: ReturnType<typeof setTimeout> | null;
  recovering: boolean;
  recoverGen: number;
};

const buckets = new Map<string, Bucket>();

function emptySnap(): InspectorLiveSnapshot {
  return {
    messages: [],
    isStreaming: false,
    interrupted: false,
    suggestions: [],
    error: null,
    sessionLoadError: null,
    completionMeta: {},
    runMetrics: {},
    sessionId: null,
    queryResults: [],
    semanticChartMessages: [],
    disambiguations: [],
    exportOffers: [],
    queryProgress: null,
    selectedModel: DEFAULT_INSPECTOR_MODEL_KEY,
    recovering: false,
  };
}

function emit(bucket: Bucket) {
  for (const listener of bucket.listeners) listener();
}

function update<K extends keyof InspectorLiveSnapshot>(
  bucket: Bucket,
  field: K,
  action: SetState<InspectorLiveSnapshot[K]>,
) {
  const prev = bucket.snap[field];
  const next = typeof action === 'function'
    ? (action as (value: InspectorLiveSnapshot[K]) => InspectorLiveSnapshot[K])(prev)
    : action;
  if (Object.is(prev, next)) return;
  bucket.snap = { ...bucket.snap, [field]: next };
  emit(bucket);
  if (field === 'messages' || field === 'sessionId') scheduleAutosave(bucket);
}

function scheduleAutosave(bucket: Bucket) {
  if (bucket.autosave) clearTimeout(bucket.autosave);
  const sessionId = bucket.snap.sessionId;
  if (!sessionId) return;
  bucket.autosave = setTimeout(() => {
    bucket.autosave = null;
    const { messages, sessionId: id } = bucket.snap;
    if (!id) return;
    void fetch(`/api/agent-lab/workbench/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    }).catch(() => {});
  }, 2000);
}

function makeSetters(bucket: Bucket): InspectorSetters {
  return {
    setLocalMessages: (action) => update(bucket, 'messages', action),
    setIsStreaming: (action) => update(bucket, 'isStreaming', action),
    setInterrupted: (action) => update(bucket, 'interrupted', action),
    setSuggestions: (action) => update(bucket, 'suggestions', action),
    setError: (action) => update(bucket, 'error', action),
    setSessionLoadError: (action) => update(bucket, 'sessionLoadError', action),
    setCompletionMeta: (action) => update(bucket, 'completionMeta', action),
    setRunMetrics: (action) => update(bucket, 'runMetrics', action),
    setCurrentSessionId: (action) => update(bucket, 'sessionId', action),
    setQueryResults: (action) => update(bucket, 'queryResults', action),
    setSemanticChartMessages: (action) => update(bucket, 'semanticChartMessages', action),
    setDisambiguations: (action) => update(bucket, 'disambiguations', action),
    setExportOffers: (action) => update(bucket, 'exportOffers', action),
    setQueryProgress: (action) => update(bucket, 'queryProgress', action),
    setPreviewModel: (action) => update(bucket, 'selectedModel', action),
  };
}

export function inspectorBucket(key: string): Bucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    const created = {
      snap: emptySnap(),
      listeners: new Set<() => void>(),
      ctrl: null,
      turnId: null,
      assistantId: null,
      userStop: false,
      model: DEFAULT_INSPECTOR_MODEL_KEY,
      autosave: null,
      recovering: false,
      recoverGen: 0,
    } as Bucket;
    created.setters = makeSetters(created);
    bucket = created;
    buckets.set(key, bucket);
  }
  return bucket;
}

export function subscribeInspectorLive(key: string, listener: () => void): () => void {
  const bucket = inspectorBucket(key);
  bucket.listeners.add(listener);
  return () => { bucket.listeners.delete(listener); };
}

export function getInspectorSnapshot(key: string): InspectorLiveSnapshot {
  return inspectorBucket(key).snap;
}

export function inspectorSetters(key: string): InspectorSetters {
  return inspectorBucket(key).setters;
}

export function setInspectorModel(key: string, model: string) {
  const bucket = inspectorBucket(key);
  if (bucket.model === model) return;
  bucket.model = model;
  const sessionId = bucket.snap.sessionId;
  if (!sessionId) return;
  void fetch(`/api/agent-lab/workbench/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_model: model }),
  }).catch(() => {});
}

function lastAssistantIndex(messages: WorkbenchMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i;
  }
  return -1;
}

/** Put the server draft on the open assistant message when it is ahead of what we have. */
export function applyInspectorDraft(key: string, text: string, force: boolean) {
  const bucket = inspectorBucket(key);
  update(bucket, 'messages', (prev) => {
    const idx = lastAssistantIndex(prev);
    const lastIsUser = prev.length > 0 && prev[prev.length - 1].role === 'user';
    if (idx < 0 || lastIsUser) {
      return [...prev, {
        id: `insp_draft_${key}`,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        turnNumber: 0,
      }];
    }
    const current = typeof prev[idx].content === 'string' ? prev[idx].content : '';
    if (!force && text.length <= current.length) return prev;
    const next = [...prev];
    next[idx] = { ...next[idx], content: text };
    return next;
  });
}

/**
 * The fetch died (tab discarded, laptop slept) but the server kept the turn.
 * Poll the saved draft until it finishes, including after this page unmounts.
 */
export function recoverInspectorTurn(key: string) {
  const bucket = inspectorBucket(key);
  if (bucket.recovering) return;
  bucket.recovering = true;
  const gen = ++bucket.recoverGen;
  update(bucket, 'recovering', true);
  update(bucket, 'isStreaming', true);
  update(bucket, 'interrupted', false);

  void (async () => {
    try {
      for (let i = 0; i < 160; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (bucket.recoverGen !== gen || bucket.userStop) return;
        const sessionId = bucket.snap.sessionId;
        if (!sessionId) return;
        const res = await fetch(`/api/agent-lab/workbench/sessions/${sessionId}`);
        if (!res.ok) continue;
        const data = (await res.json()) as {
          session?: { progress?: { inspectorDraft?: { status?: string; text?: string } } };
        };
        const draft = data.session?.progress?.inspectorDraft;
        if (draft && typeof draft.text === 'string' && draft.text) {
          applyInspectorDraft(key, draft.text, draft.status !== 'running');
        }
        if (!draft || draft.status !== 'running') return;
      }
    } catch {
      /* keep the partial reply; the next visit loads the saved draft */
    } finally {
      if (bucket.recoverGen === gen) {
        bucket.recovering = false;
        update(bucket, 'recovering', false);
        if (!bucket.userStop) update(bucket, 'isStreaming', false);
      }
    }
  })();
}

/**
 * Stop polling a dropped turn's draft (Stop pressed). Without clearing `recovering`, the next
 * turn would think it is still recovering and never leave the streaming state.
 */
export function stopInspectorRecovery(key: string) {
  const bucket = inspectorBucket(key);
  bucket.recoverGen += 1;
  bucket.recovering = false;
  update(bucket, 'recovering', false);
}

/** New chat / explicit reset. Does not run when the page unmounts. */
export function resetInspectorLive(key: string) {
  const bucket = inspectorBucket(key);
  bucket.userStop = true;
  bucket.recoverGen += 1;
  bucket.recovering = false;
  bucket.ctrl?.abort();
  bucket.ctrl = null;
  bucket.turnId = null;
  bucket.assistantId = null;
  if (bucket.autosave) clearTimeout(bucket.autosave);
  bucket.autosave = null;
  const model = bucket.snap.selectedModel;
  bucket.snap = { ...emptySnap(), selectedModel: model };
  emit(bucket);
}
