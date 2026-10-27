'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from '@/lib/navigation';
import { X, ArrowUpRight, Table2 } from 'lucide-react';
import { History, FlaskConical, SquarePen, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { PromptCanvas } from '@/components/workbench/PromptCanvas';
import { HistoryDrawer } from '@/components/workbench/HistoryDrawer';
import { Companion } from '@/components/companion/Companion';
import { DashboardPane } from './DashboardPane';
import { SemanticChartCard } from './SemanticChartCard';
import { DisambiguationCard } from './DisambiguationCard';
import { ExportReadyCard } from './ExportReadyCard';
import { EmptyStatePrompts } from './EmptyStatePrompts';
import { QueryProgressCard } from './QueryProgressCard';
import { SemanticGovernancePanel, RightPaneTabBar } from './SemanticGovernancePanel';
import type { RightPaneTab } from './SemanticGovernancePanel';
import { DataStudio } from '@/components/studio/DataStudio';
import { useInspectorChat } from '@/hooks/useInspectorChat';
import { useSession } from 'next-auth/react';
import { canViewAgentOpsRole } from '@/lib/agent-ops/role-gate';
import { DeveloperPane } from '@/components/agent-ops/DeveloperPane';
import { AgentHandoffCard } from './AgentHandoffCard';
import { detectAgentBuildIntent } from '@/lib/construction/handoff';
import { type } from '@/lib/typography/tokens';

// ── Styles ────────────────────────────────────────────────────────────────────
// Hover / focus / press states live in CSS (not onMouseEnter handlers) so they work
// with the keyboard, are skipped on touch, and stay in one place. Colors are theme
// tokens only, so light, dark and the user's accent all flow through.
const INSPECTOR_CSS = `
.insp-bar { display:flex; align-items:center; gap:16px; height:48px; padding:0 12px 0 20px; flex-shrink:0;
  background:var(--wb-canvas); border-bottom:1px solid var(--wb-border-subtle); }
.insp-status { display:inline-flex; align-items:center; gap:7px; color:var(--ink-2); white-space:nowrap; }
.insp-status-dot { width:6px; height:6px; border-radius:50%; background:var(--ink-3); flex-shrink:0; }
.insp-status[data-state="ok"] .insp-status-dot { background:var(--ok); box-shadow:0 0 0 3px var(--ok-bg); }
.insp-status[data-state="off"] .insp-status-dot { background:var(--warn); box-shadow:0 0 0 3px var(--warn-bg); }
.insp-seg { display:inline-flex; gap:2px; padding:2px; border-radius:8px; background:var(--surface-2); border:1px solid var(--line-1); }
.insp-seg button { height:24px; padding:0 10px; border:none; border-radius:6px; background:transparent; color:var(--ink-2);
  cursor:pointer; white-space:nowrap; transition:background-color 150ms ease, color 150ms ease; }
.insp-seg button[aria-checked="true"] { background:var(--surface-1); color:var(--ink-1);
  box-shadow:0 0 0 1px var(--line-1), 0 1px 2px rgba(0,0,0,.08); }
.insp-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:30px; padding:0 10px;
  border:1px solid transparent; border-radius:6px; background:transparent; color:var(--ink-2); cursor:pointer; white-space:nowrap;
  transition:background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease-out; }
.insp-btn--icon { width:30px; padding:0; }
.insp-btn--outline { border-color:var(--line-2); color:var(--ink-1); }
.insp-btn:active, .insp-starter:active, .insp-strip:active { transform:scale(0.97); }
.insp-strip { width:40px; flex-shrink:0; display:flex; flex-direction:column; align-items:center; gap:10px; padding:12px 0 0;
  border:none; background:var(--wb-canvas); color:var(--ink-2); cursor:pointer;
  transition:background-color 150ms ease, color 150ms ease; }
.insp-strip-dot { width:6px; height:6px; border-radius:50%; background:var(--brand-a); }
.insp-starter { display:flex; align-items:center; gap:10px; width:100%; padding:10px 14px; text-align:left;
  border:1px solid var(--line-1); border-radius:8px; background:var(--surface-1); color:var(--ink-1); cursor:pointer;
  transition:border-color 150ms ease, background-color 150ms ease, transform 120ms ease-out; }
.insp-starter svg { color:var(--ink-3); flex-shrink:0; transition:color 150ms ease; }
@media (hover:hover) and (pointer:fine) {
  .insp-btn:hover, .insp-strip:hover, .insp-seg button:not([aria-checked="true"]):hover {
    background:color-mix(in srgb, var(--ink-1) 7%, transparent); color:var(--ink-1); }
  .insp-starter:hover { border-color:color-mix(in srgb, var(--brand-a) 45%, transparent);
    background:color-mix(in srgb, var(--brand-a) 5%, var(--surface-1)); }
  .insp-starter:hover svg { color:var(--brand-a-ink); }
}
.insp-btn:focus-visible, .insp-seg button:focus-visible, .insp-strip:focus-visible, .insp-starter:focus-visible {
  outline:2px solid var(--brand-a); outline-offset:1px; }
.insp-welcome { animation:insp-in 260ms cubic-bezier(0.23, 1, 0.32, 1) both; }
@keyframes insp-in { from { opacity:0; transform:translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .insp-welcome { animation:none; } }
`;

// ── Inspector status bar ──────────────────────────────────────────────────────
// The app header above already shows the "Inspector" breadcrumb, so this bar carries
// only what belongs to the session: its title, the warehouse status, the context
// mode and the session actions.
interface InspectorStatusBarProps {
  sessionTitle: string;
  sessionId: string | null;
  /** null while the connection check is in flight. */
  dbConnected: boolean | null;
  contextMode: 'harvested' | 'warehouse_only';
  onContextModeChange: (mode: 'harvested' | 'warehouse_only') => void;
  onOpenHistory: () => void;
  onOpenLab: () => void;
  onNewSession: () => void;
}

function InspectorStatusBar({ sessionTitle, sessionId, dbConnected, contextMode, onContextModeChange, onOpenHistory, onOpenLab, onNewSession }: InspectorStatusBarProps) {
  const modes: { id: 'harvested' | 'warehouse_only'; label: string; hint: string }[] = [
    { id: 'harvested', label: 'Catalog + SQL', hint: 'Answer with harvested catalog context (T0/T1/T2) plus live SQL' },
    { id: 'warehouse_only', label: 'SQL only', hint: 'Answer with raw Databricks SQL only' },
  ];

  return (
    <div className="insp-bar">
      {/* LEFT — session title */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          title={sessionId ? `Session ${sessionId}` : undefined}
          style={{
            ...type['ui-lg'], display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: sessionTitle ? 'var(--ink-1)' : 'var(--ink-2)',
          }}
        >
          {sessionTitle || 'New session'}
        </span>
      </div>

      {/* CENTER — warehouse status + context mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <span
          className="insp-status"
          data-state={dbConnected === null ? 'pending' : dbConnected ? 'ok' : 'off'}
          style={type['ui-regular']}
          role="status"
        >
          <span className="insp-status-dot" />
          {dbConnected === null ? 'Checking Databricks…' : dbConnected ? 'Databricks connected' : 'Databricks not connected'}
        </span>
        <div className="insp-seg" role="radiogroup" aria-label="Context mode">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={contextMode === m.id}
              title={m.hint}
              onClick={() => onContextModeChange(m.id)}
              style={type.label}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT — session actions */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
        <button type="button" className="insp-btn insp-btn--outline" onClick={onNewSession} style={type.ui}>
          <SquarePen size={14} />
          New session
        </button>
        <button type="button" className="insp-btn insp-btn--icon" onClick={onOpenHistory} aria-label="Chat history" title="Chat history">
          <History size={16} />
        </button>
        <button type="button" className="insp-btn insp-btn--icon" onClick={onOpenLab} aria-label="Performance Lab" title="Performance Lab — compare model metrics">
          <FlaskConical size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Welcome (empty conversation) ──────────────────────────────────────────────
// One empty state for the whole page: a clear question, one line on what Inspector
// does, and starter questions. Governed models supply their own prompts.
const GENERIC_STARTERS = [
  'What data can I explore here?',
  'Which tables were updated most recently?',
  'Show the largest tables by row count',
];

function InspectorWelcome({ modelId, onPrompt }: { modelId: string | null; onPrompt: (p: string) => void }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', placeItems: 'center', padding: '32px 24px' }}>
      <div className="insp-welcome" style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <Companion size={56} />
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ ...type['title-section'], color: 'var(--ink-1)', margin: 0 }}>What do you want to know?</h2>
          <p style={{ ...type.body, color: 'var(--ink-2)', margin: 0, maxWidth: 440 }}>
            Ask in plain language. Inspector queries your warehouse, explains the numbers and builds charts.
          </p>
        </div>
        {modelId ? (
          <EmptyStatePrompts modelId={modelId} includeWhatIsThis showHeading={false} onPromptClick={onPrompt} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 440 }}>
            {GENERIC_STARTERS.map((p) => (
              <button key={p} type="button" className="insp-starter" onClick={() => onPrompt(p)} style={type['ui-regular']}>
                <ArrowUpRight size={15} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
              </button>
            ))}
          </div>
        )}
      </div>
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
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [contextMode, setContextMode] = useState<'harvested' | 'warehouse_only'>('harvested');
  const expandButtonRef = useRef<HTMLButtonElement>(null);

  // Governance tab state — populated on mount from /api/inspector/semantic/candidates
  const [hasCandidateModels, setHasCandidateModels] = useState(false);
  const [candidateModelId, setCandidateModelId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightPaneTab>('results');
  // Results / Developer pane starts minimized and opens itself when new results arrive.
  const [rightCollapsed, setRightCollapsed] = useState(true);

  const { data: authSession } = useSession();
  const showDeveloperTab = canViewAgentOpsRole(authSession?.user?.role);

  const insp = useInspectorChat({ sessionId: initialSessionId ?? null, contextMode });

  // ── Agent-build intent → Agent Lab handoff card ─────────────────────────────
  // Inspector explores data; agents are built in Agent Lab. When the latest user
  // message asks to create an agent, offer the handoff instead of leaving the user here.
  const [dismissedHandoffId, setDismissedHandoffId] = useState<string | null>(null);
  const lastUserMessage = [...insp.messages].reverse().find((m) => m.role === 'user') ?? null;
  const showAgentHandoff =
    !!lastUserMessage &&
    !insp.isStreaming &&
    dismissedHandoffId !== lastUserMessage.id &&
    detectAgentBuildIntent(lastUserMessage.content);

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

  // ── Generative empty-state landing (Phase 3B) ────────────────────────────────
  // A starter prompt from a dashboard empty state opens /inspector?prompt=<text>.
  // Prefill the composer so the user can send it (or tweak it first).
  const promptParam = searchParams?.get('prompt') ?? null;
  useEffect(() => {
    if (!promptParam) return;
    setComposer((c) => c || promptParam);
  }, [promptParam]);

  // Check Databricks connectivity on mount
  useEffect(() => {
    fetch('/api/databricks/connections')
      .then(r => r.ok ? r.json() : { connections: [] })
      .then((d: { connections?: { status?: string }[] }) => {
        const hasActive = (d.connections ?? []).some((c) => c.status === 'active');
        setDbConnected(hasActive);
      })
      .catch(() => setDbConnected(false));
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

  // ── Auto-open the results pane when something new lands in it ───────────────
  // Counted, not boolean, so a second chart re-opens a pane the user minimized after
  // the first. Collapsing again keeps it closed until the next new item.
  const resultItemCount =
    insp.queryResults.length + insp.semanticChartMessages.length + insp.disambiguations.length + insp.exportOffers.length;
  const prevResultCountRef = useRef(resultItemCount);
  useEffect(() => {
    if (resultItemCount > prevResultCountRef.current) setRightCollapsed(false);
    prevResultCountRef.current = resultItemCount;
  }, [resultItemCount]);
  const hasResults = resultItemCount > 0;

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

  // The user's latest question — pre-fills DefineMetricPanel's NL-intent when a
  // chart is saved as a metric (3.5B chat-capture). Strips the invisible
  // "[Refining …]" context block a refinement prepends, so the captured intent
  // reads as the human question, not the machinery. Not per-chart-tracked; the
  // most recent user question is a good-enough seed the author can adjust.
  const latestUserQuestion = (() => {
    for (let i = insp.messages.length - 1; i >= 0; i--) {
      const m = insp.messages[i];
      if (m.role === 'user' && m.content) {
        return m.content.replace(/^\s*\[[^\]]*\]\s*/s, '').trim();
      }
    }
    return undefined;
  })();
  const showResultsEmptyState = !hasResults && !insp.queryProgress;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--wb-canvas)', overflow: 'hidden' }}>
      <style>{INSPECTOR_CSS}</style>
      <InspectorStatusBar
        sessionTitle={sessionTitle}
        sessionId={insp.sessionId}
        dbConnected={dbConnected}
        contextMode={contextMode}
        onContextModeChange={setContextMode}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenLab={() => {
          router.push('/performance-lab');
        }}
        onNewSession={handleReset}
      />

      {sourceChartNotice && (
        <div
          role="status"
          style={{
            ...type['ui-regular'], display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 20px', flexShrink: 0, color: 'var(--ink-1)',
            background: 'var(--brand-a-soft)', borderBottom: '1px solid color-mix(in srgb, var(--brand-a) 25%, transparent)',
          }}
        >
          <span style={{ flex: 1 }}>{sourceChartNotice}</span>
          <button
            type="button"
            className="insp-btn insp-btn--icon"
            aria-label="Dismiss"
            onClick={() => setSourceChartNotice(null)}
            style={{ width: 24, height: 24 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT — conversation (full width while the results pane is minimized) */}
        <div style={{ flex: rightCollapsed ? 1 : '0 0 60%', minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--wb-border-subtle)', overflow: 'hidden', minHeight: 0 }}>
          <PromptCanvas
            chatError={insp.error}
            surface="inspector"
            emptyState={<InspectorWelcome modelId={candidateModelId} onPrompt={(p) => insp.send(p)} />}
            banner={showAgentHandoff && lastUserMessage ? (
              <AgentHandoffCard
                inspectorSessionId={insp.sessionId}
                mission={lastUserMessage.content}
                onDismiss={() => setDismissedHandoffId(lastUserMessage.id)}
              />
            ) : null}
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
            modelOptions={insp.availableModels}
            canCommission={false}
            onReset={handleReset}
            assumptionLedger={[]}
            classSuggestion={null}
            sessionId={insp.sessionId}
          />
        </div>

        {/* RIGHT — results / semantic governance / developer */}
        {rightCollapsed && (
          <button
            type="button"
            className="insp-strip"
            onClick={() => setRightCollapsed(false)}
            aria-label={showDeveloperTab ? 'Show results and developer panel' : 'Show results panel'}
            title="Show results"
            style={type.label}
          >
            <PanelRightOpen size={16} />
            {hasResults && <span className="insp-strip-dot" aria-hidden />}
            <span style={{ writingMode: 'vertical-rl' }}>Results</span>
          </button>
        )}
        <div style={{ flex: '1 1 40%', minWidth: 0, display: rightCollapsed ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <RightPaneTabBar
            activeTab={rightTab}
            onChange={setRightTab}
            showSemantic={hasCandidateModels}
            showDeveloper={showDeveloperTab}
            trailing={
              <button
                type="button"
                className="insp-btn insp-btn--icon"
                onClick={() => setRightCollapsed(true)}
                aria-label="Minimize panel"
                title="Minimize"
                style={{ width: 28, height: 28 }}
              >
                <PanelRightClose size={16} />
              </button>
            }
          />
          {rightTab === 'developer' && showDeveloperTab ? (
            <DeveloperPane
              sessionId={insp.sessionId}
              messages={insp.messages}
              isStreaming={insp.isStreaming}
              selectedModel={insp.selectedModel}
              dbConnected={dbConnected === true}
              contextMode={contextMode}
              surface="inspector"
            />
          ) : rightTab === 'results' || !hasCandidateModels ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {showResultsEmptyState ? (
                <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: 300, textAlign: 'center' }}>
                    <Table2 size={20} style={{ color: 'var(--ink-3)' }} />
                    <span style={{ ...type.ui, color: 'var(--ink-1)' }}>No results yet</span>
                    <span style={{ ...type['ui-regular'], color: 'var(--ink-2)' }}>
                      Tables and charts from your questions appear here.
                    </span>
                  </div>
                </div>
              ) : (
              <>
              {/* Semantic chart cards + disambiguation + in-flight progress — above query results */}
              {(insp.semanticChartMessages.length > 0 || insp.disambiguations.length > 0 || insp.exportOffers.length > 0 || insp.queryProgress) && (
                <div
                  style={{
                    flexShrink: 0,
                    maxHeight: '55%',
                    overflowY: 'auto',
                    padding: '12px 12px 0',
                    borderBottom: '1px solid var(--wb-border-subtle)',
                  }}
                >
                  {insp.disambiguations.map((dm) => (
                    <DisambiguationCard
                      key={dm.id}
                      message={dm}
                      modelId={candidateModelId}
                      onChoose={(followUp) => insp.send(followUp)}
                    />
                  ))}
                  {insp.exportOffers.map((eo) => (
                    <ExportReadyCard key={eo.id} message={eo} />
                  ))}
                  {insp.semanticChartMessages.map((scm) => (
                    <SemanticChartCard
                      key={scm.id}
                      message={scm}
                      echartsOption={scm.echartsOption}
                      sourceChartId={sourceChartId}
                      onRefine={(followUp) => insp.send(followUp)}
                      originalQuestion={latestUserQuestion}
                    />
                  ))}
                  {insp.queryProgress && <QueryProgressCard progress={insp.queryProgress} />}
                </div>
              )}
              <DashboardPane
                queryResults={insp.queryResults}
                onOpenStudio={() => setStudioOpen(true)}
                expandButtonRef={expandButtonRef}
                latestQuestion={latestUserQuestion}
                graduateModelId={candidateModelId}
                sessionId={insp.sessionId ?? undefined}
              />
              </>
              )}
            </div>
          ) : (
            <SemanticGovernancePanel modelId={candidateModelId!} />
          )}
        </div>
      </div>

      <DataStudio
        open={studioOpen}
        results={insp.queryResults}
        sessionId={insp.sessionId ?? undefined}
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
