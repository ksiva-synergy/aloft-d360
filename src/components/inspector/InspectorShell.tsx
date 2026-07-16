'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { History, FlaskConical, SquarePen } from 'lucide-react';
import { PromptCanvas } from '@/components/workbench/PromptCanvas';
import { HistoryDrawer } from '@/components/workbench/HistoryDrawer';
import { AloftSigil } from '@/components/workbench/atoms';
import { DashboardPane } from './DashboardPane';
import { SemanticChartCard } from './SemanticChartCard';
import { SemanticGovernancePanel, RightPaneTabBar } from './SemanticGovernancePanel';
import type { RightPaneTab } from './SemanticGovernancePanel';
import { DataStudio } from '@/components/studio/DataStudio';
import { useInspectorChat } from '@/hooks/useInspectorChat';
import type { QueryResult } from '@/hooks/useInspectorChat';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const GOLD = '#FDB515';

// ── Inspector status bar ──────────────────────────────────────────────────────
interface InspectorStatusBarProps {
  sessionTitle: string;
  sessionId: string | null;
  dbConnected: boolean;
  contextMode: 'harvested' | 'warehouse_only';
  onToggleContextMode: () => void;
  onOpenHistory: () => void;
  onOpenLab: () => void;
  onNewSession: () => void;
}

function InspectorStatusBar({ sessionTitle, sessionId, dbConnected, contextMode, onToggleContextMode, onOpenHistory, onOpenLab, onNewSession }: InspectorStatusBarProps) {
  const shortId = sessionId ? sessionId.slice(-8) : '————————';
  const isHarvested = contextMode === 'harvested';

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        padding: '0 24px',
        height: 48,
        flexShrink: 0,
        background: 'var(--wb-canvas)',
        borderBottom: '1px solid var(--wb-border-subtle)',
        ...mono,
        fontSize: 11,
        letterSpacing: '0.04em',
        overflow: 'hidden',
      }}
    >
      {/* LEFT — breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--wb-muted)', whiteSpace: 'nowrap', minWidth: 0 }}>
        <AloftSigil size={14} />
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>SPINOR</span>
        <span style={{ color: 'var(--wb-muted)', opacity: 0.5 }}>/</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10, color: GOLD }}>INSPECTOR</span>
        <span style={{ color: 'var(--wb-muted)', opacity: 0.5 }}>/</span>
        <span style={{ color: 'var(--wb-ink-dim)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
          {sessionTitle || 'New Session'}
        </span>
      </div>

      {/* CENTER — DATABRICKS CONNECTED chip + context mode toggle */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
      }}>
        {/* Databricks connected chip */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            ...mono,
            fontSize: 9,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: dbConnected ? GOLD : 'var(--wb-muted)',
            background: dbConnected ? 'rgba(253,181,21,0.08)' : 'rgba(74,96,128,0.12)',
            border: dbConnected ? '1px solid rgba(253,181,21,0.25)' : '1px solid rgba(74,96,128,0.25)',
            borderRadius: 4,
            padding: '3px 8px',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: dbConnected ? GOLD : '#4a6080',
              display: 'inline-block',
              flexShrink: 0,
              animation: dbConnected ? 'insp-pulse 2s ease-in-out infinite' : 'none',
            }}
          />
          DATABRICKS {dbConnected ? 'CONNECTED' : 'CHECKING…'}
        </span>

        {/* Divider */}
        <span style={{ width: 1, height: 12, background: 'rgba(253,181,21,0.15)', flexShrink: 0 }} />

        {/* Context mode toggle */}
        <button
          onClick={onToggleContextMode}
          title={isHarvested
            ? 'Using harvested catalog context (T0/T1/T2). Click to switch to SQL-only mode.'
            : 'Using raw Databricks SQL only. Click to switch back to catalog context mode.'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            ...mono,
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            border: `1px solid ${isHarvested ? 'rgba(253,181,21,0.35)' : 'rgba(147,197,253,0.35)'}`,
            borderRadius: 4,
            padding: '3px 8px',
            background: isHarvested ? 'rgba(253,181,21,0.06)' : 'rgba(147,197,253,0.06)',
            color: isHarvested ? GOLD : '#93C5FD',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = isHarvested ? 'rgba(253,181,21,0.14)' : 'rgba(147,197,253,0.14)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = isHarvested ? 'rgba(253,181,21,0.06)' : 'rgba(147,197,253,0.06)';
          }}
        >
          {/* Toggle pill */}
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            width: 24,
            height: 12,
            borderRadius: 6,
            background: isHarvested ? 'rgba(253,181,21,0.25)' : 'rgba(147,197,253,0.15)',
            position: 'relative',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}>
            <span style={{
              position: 'absolute',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isHarvested ? GOLD : '#93C5FD',
              left: isHarvested ? 2 : 14,
              transition: 'left 0.15s, background 0.15s',
            }} />
          </span>
          {isHarvested ? 'CATALOG + SQL' : 'SQL ONLY'}
        </button>
      </div>

      {/* RIGHT — new session + lab button + history button + session */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--wb-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        <button
          onClick={onNewSession}
          title="New session"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 5,
            height: 28, borderRadius: 6,
            padding: '0 10px',
            background: 'transparent', border: `1px solid rgba(253,181,21,0.30)`,
            color: GOLD, cursor: 'pointer', transition: 'all 0.15s',
            ...mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
            flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(253,181,21,0.10)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <SquarePen size={11} />
          NEW
        </button>
        <button
          onClick={onOpenLab}
          title="Performance Lab — compare model metrics"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6,
            background: 'transparent', border: '1px solid rgba(253,181,21,0.15)',
            color: 'var(--wb-muted)', cursor: 'pointer', transition: 'all 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; e.currentTarget.style.background = 'rgba(253,181,21,0.06)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(253,181,21,0.15)'; e.currentTarget.style.color = 'var(--wb-muted)'; e.currentTarget.style.background = 'transparent'; }}
        >
          <FlaskConical size={13} />
        </button>
        <button
          onClick={onOpenHistory}
          title="Chat History"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 6,
            background: 'transparent', border: '1px solid rgba(253,181,21,0.15)',
            color: 'var(--wb-muted)', cursor: 'pointer', transition: 'all 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(253,181,21,0.15)'; e.currentTarget.style.color = 'var(--wb-muted)'; }}
        >
          <History size={13} />
        </button>
        <span style={{ fontSize: 10 }}>
          SESSION <span style={{ color: 'var(--wb-ink-dim)' }}>{shortId}</span>
        </span>
        <span style={{ width: 1, height: 14, background: 'rgba(253,181,21,0.15)', flexShrink: 0 }} />
        <span style={{ fontSize: 9, letterSpacing: '0.08em' }}>POWERED BY ALOFT · v0.4</span>
      </div>

      <style>{`
        @keyframes insp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}

// ── InspectorShell ────────────────────────────────────────────────────────────
interface InspectorShellProps {
  sessionId?: string;
}

export default function InspectorShell({ sessionId: initialSessionId }: InspectorShellProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [composer, setComposer] = useState('');
  const [sourceChartNotice, setSourceChartNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [dbConnected, setDbConnected] = useState(false);
  const [contextMode, setContextMode] = useState<'harvested' | 'warehouse_only'>('harvested');
  const expandButtonRef = useRef<HTMLButtonElement>(null);

  // Governance tab state — populated on mount from /api/inspector/semantic/candidates
  const [hasCandidateModels, setHasCandidateModels] = useState(false);
  const [candidateModelId, setCandidateModelId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightPaneTab>('results');

  const insp = useInspectorChat({ sessionId: initialSessionId ?? null, contextMode });

  // ── "View source" landing (Phase 2 provenance) ──────────────────────────────
  // A widget's source link opens /inspector?sourceChart=<id>. Resolve the chart
  // and pre-load the composer so the user can refine it in a fresh session; if
  // the chart was deleted, say so gracefully (a dangling ref is expected).
  const sourceChartId = searchParams?.get('sourceChart') ?? null;
  useEffect(() => {
    if (!sourceChartId) return;
    let cancelled = false;
    fetch(`/api/inspector/charts/${sourceChartId}`)
      .then((r) => (r.ok ? r.json() as Promise<{ chart: { name: string } }> : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        setSourceChartNotice(`Refining source chart: ${data.chart.name}`);
        setComposer((c) => c || `Refine the "${data.chart.name}" chart — `);
      })
      .catch(() => { if (!cancelled) setSourceChartNotice('That source chart is no longer available.'); });
    return () => { cancelled = true; };
  }, [sourceChartId]);

  // Check Databricks connectivity on mount
  useEffect(() => {
    fetch('/api/databricks/connections')
      .then(r => r.ok ? r.json() : { connections: [] })
      .then((d: { connections?: { status?: string }[] }) => {
        const hasActive = (d.connections ?? []).some((c) => c.status === 'active');
        setDbConnected(hasActive);
      })
      .catch(() => {});
  }, []);

  // Check for candidate semantic models on mount — determines Semantic tab visibility
  useEffect(() => {
    fetch('/api/inspector/semantic/candidates')
      .then(r => r.ok ? r.json() : { exists: false, modelId: null })
      .then((d: { exists: boolean; modelId: string | null }) => {
        setHasCandidateModels(d.exists);
        setCandidateModelId(d.modelId);
      })
      .catch(() => {});
  }, []);

  // Auto-rename after first and second assistant response
  const renamePhaseRef = useRef(0);
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = insp.isStreaming;
    if (!wasStreaming || insp.isStreaming) return;
    if (!insp.sessionId) return;
    const msgs = insp.messages;
    const userMsgs = msgs.filter(m => m.role === 'user');
    const assistantMsgs = msgs.filter(m => m.role === 'assistant');
    const shouldRename = (
      (renamePhaseRef.current === 0 && assistantMsgs.length === 1 && userMsgs.length >= 1) ||
      (renamePhaseRef.current === 1 && assistantMsgs.length === 2 && userMsgs.length >= 2)
    );
    if (!shouldRename) return;
    renamePhaseRef.current++;
    const sid = insp.sessionId;
    const titleMsgs = userMsgs.slice(0, 2).map(m => ({ role: 'user', content: typeof m.content === 'string' ? m.content : String(m.content ?? '') }));
    fetch('/api/agent-lab/workbench/generate-title', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: titleMsgs }),
    })
      .then(r => r.json())
      .then((data: { title: string | null }) => {
        if (data.title) {
          setSessionTitle(data.title);
          fetch(`/api/agent-lab/workbench/sessions/${sid}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: data.title }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }, [insp.isStreaming, insp.messages, insp.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(() => {
    const text = composer.trim();
    if (!text || insp.isStreaming) return;
    insp.send(text);
    setComposer('');
  }, [composer, insp]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStop = useCallback(() => {
    insp.abort();
  }, [insp]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditMessage = useCallback((messageId: string) => {
    const result = insp.editMessage(messageId);
    if (result) setComposer(result.content);
  }, [insp]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = useCallback(() => {
    renamePhaseRef.current = 0;
    prevStreamingRef.current = false;
    setSessionTitle('');
    insp.reset();
  }, [insp]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--wb-canvas)', overflow: 'hidden' }}>
      <InspectorStatusBar
        sessionTitle={sessionTitle}
        sessionId={insp.sessionId}
        dbConnected={dbConnected}
        contextMode={contextMode}
        onToggleContextMode={() => setContextMode(m => m === 'harvested' ? 'warehouse_only' : 'harvested')}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenLab={() => {
          router.push('/performance-lab');
        }}
        onNewSession={handleReset}
      />

      {sourceChartNotice && (
        <div
          style={{
            ...mono, fontSize: 10, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 24px', flexShrink: 0, color: GOLD,
            background: 'rgba(253,181,21,0.08)', borderBottom: '1px solid rgba(253,181,21,0.2)',
          }}
        >
          <span style={{ flex: 1 }}>{sourceChartNotice}</span>
          <button
            onClick={() => setSourceChartNotice(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: GOLD, display: 'flex' }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT — 60% conversation */}
        <div style={{ width: '60%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--wb-border-subtle)', overflow: 'hidden', minHeight: 0 }}>
          <PromptCanvas
            messages={insp.messages}
            isStreaming={insp.isStreaming}
            readiness={null}
            interrupted={insp.interrupted}
            suggestions={insp.suggestions}
            completionMeta={insp.completionMeta}
            promptValue={composer}
            setPromptValue={setComposer}
            onSubmit={handleSubmit}
            onStop={handleStop}
            onEditMessage={handleEditMessage}
            isCommissioning={false}
            selectedModel={insp.selectedModel}
            onModelChange={insp.setSelectedModel}
            canCommission={false}
            onReset={handleReset}
            assumptionLedger={[]}
            classSuggestion={null}
            sessionId={insp.sessionId}
          />
        </div>

        {/* RIGHT — 40% dashboard / semantic governance */}
        <div style={{ width: '40%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {hasCandidateModels && (
            <RightPaneTabBar activeTab={rightTab} onChange={setRightTab} />
          )}
          {rightTab === 'results' || !hasCandidateModels ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Semantic chart cards — appear above query results when present */}
              {insp.semanticChartMessages.length > 0 && (
                <div
                  style={{
                    flexShrink: 0,
                    maxHeight: '55%',
                    overflowY: 'auto',
                    padding: '10px 12px 0',
                    borderBottom: '1px solid var(--wb-border-subtle)',
                  }}
                >
                  {insp.semanticChartMessages.map((scm) => (
                    <SemanticChartCard
                      key={scm.id}
                      message={scm}
                      echartsOption={scm.echartsOption}
                    />
                  ))}
                </div>
              )}
              <DashboardPane
                queryResults={insp.queryResults}
                onOpenStudio={() => setStudioOpen(true)}
                expandButtonRef={expandButtonRef}
              />
            </div>
          ) : (
            <SemanticGovernancePanel modelId={candidateModelId!} />
          )}
        </div>
      </div>

      <DataStudio
        open={studioOpen}
        results={insp.queryResults}
        onClose={() => {
          setStudioOpen(false);
          // Return focus to the EXPAND button that opened the Studio
          requestAnimationFrame(() => expandButtonRef.current?.focus());
        }}
      />

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentSessionId={insp.sessionId}
      />
    </div>
  );
}
