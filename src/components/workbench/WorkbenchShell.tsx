'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { History, SquarePen, Bot } from 'lucide-react';
import { PromptCanvas } from '@/components/workbench/PromptCanvas';
import { HistoryDrawer } from '@/components/workbench/HistoryDrawer';
import { ConfigPanel } from '@/components/workbench/ConfigPanel';
import { AloftSigil } from '@/components/workbench/atoms';
import { useWorkbenchChat } from '@/hooks/useWorkbenchChat';
import { useSession } from 'next-auth/react';
import { canViewAgentOpsRole } from '@/lib/agent-ops/role-gate';
import { DeveloperPane } from '@/components/agent-ops/DeveloperPane';
import { canCommissionAgent } from '@/lib/construction/readiness';
import { emptyConstructionDraft } from '@/lib/construction/empty-draft';
import { takeWorkbenchSeed } from '@/lib/construction/handoff';
import { type } from '@/lib/typography/tokens';
import {
  AGENTS_LIST_HREF,
  AGENTS_WORKBENCH_HREF,
  agentsWorkbenchSessionHref,
  isAgentsWorkbenchBasePath,
} from '@/lib/navigation/agents-routes';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const GOLD = '#FDB515';

export default function WorkbenchShell({ sessionId: initialSessionId }: { sessionId?: string } = {}) {
  const router = useRouter();
  const [composer, setComposer] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('New Session');
  const [rightPane, setRightPane] = useState<'config' | 'developer'>('config');
  const { data: authSession } = useSession();
  const showDeveloperTab = canViewAgentOpsRole(authSession?.user?.role);

  const wb = useWorkbenchChat({
    sessionId: initialSessionId ?? null,
    onSessionCreated: (id) => {
      if (typeof window !== 'undefined' && isAgentsWorkbenchBasePath(window.location.pathname)) {
        window.history.replaceState(null, '', agentsWorkbenchSessionHref(id));
      }
    },
  });

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || wb.isStreaming) return;
      wb.send(trimmed);
      setComposer('');
      if (!sessionTitle || sessionTitle === 'New Session') {
        setSessionTitle(trimmed.slice(0, 48) + (trimmed.length > 48 ? '…' : ''));
      }
    },
    [wb, sessionTitle],
  );

  const handleSubmit = useCallback(() => {
    sendMessage(composer);
  }, [composer, sendMessage]);

  // Inspector handoff: the new session arrives with a seeded first message. Send it once,
  // after the (empty) session has loaded so the load can't overwrite the streaming turn.
  const seedSentRef = useRef(false);
  useEffect(() => {
    if (seedSentRef.current || !initialSessionId) return;
    if (wb.hydratedSessionId !== initialSessionId || wb.messages.length > 0) return;
    const seed = takeWorkbenchSeed(initialSessionId);
    if (!seed) return;
    seedSentRef.current = true;
    sendMessage(seed);
  }, [initialSessionId, wb.hydratedSessionId, wb.messages.length, sendMessage]);

  const readinessUi =
    wb.readiness === 'validate' || wb.readiness === 'commission'
      ? 'build'
      : wb.readiness === 'plan' || wb.readiness === 'build'
        ? wb.readiness
        : 'interview';

  const draftState = wb.constructionState ?? (wb.sessionId ? emptyConstructionDraft() : null);
  const canCommission = draftState ? canCommissionAgent(draftState) : false;

  return (
    <div className="workbench-frame" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--wb-canvas)', overflow: 'hidden' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          height: 48,
          flexShrink: 0,
          borderBottom: '1px solid var(--wb-border-subtle)',
          ...type['ui-regular'],
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--wb-muted)' }}>
          <AloftSigil size={14} />
          <span style={{ ...type.label }}>Data 360</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ ...type.label, color: GOLD }}>Agent Lab</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ ...type.label, color: 'var(--wb-ink-dim)' }}>Workbench</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ color: 'var(--wb-ink-dim)', fontSize: 'var(--type-caption-size)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sessionTitle}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              wb.reset();
              setSessionTitle('New Session');
              router.push(AGENTS_WORKBENCH_HREF);
            }}
            title="New agent"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              height: 28,
              padding: '0 10px',
              borderRadius: 6,
              background: 'transparent',
              border: `1px solid rgba(253,181,21,0.30)`,
              color: GOLD,
              cursor: 'pointer',
              ...type['ui-regular'],
            }}
          >
            <SquarePen size={11} /> New
          </button>
          <button
            type="button"
            onClick={() => router.push(AGENTS_LIST_HREF)}
            title="Saved agents"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              height: 28,
              padding: '0 10px',
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid rgba(253,181,21,0.15)',
              color: 'var(--wb-muted)',
              cursor: 'pointer',
              ...type['ui-regular'],
            }}
          >
            <Bot size={11} /> Agents
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            title="History"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid rgba(253,181,21,0.15)',
              color: 'var(--wb-muted)',
              cursor: 'pointer',
            }}
          >
            <History size={13} />
          </button>
        </div>
      </header>

      {(wb.error || wb.sessionLoadError) && (
        <div
          style={{
            ...type['ui-regular'],
            padding: '8px 24px',
            flexShrink: 0,
            color: '#ef4444',
            background: 'rgba(239,68,68,0.08)',
            borderBottom: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          {wb.error || wb.sessionLoadError}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <div style={{ width: '58%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--wb-border-subtle)', minHeight: 0 }}>
          <PromptCanvas
            chatError={wb.error}
            messages={wb.messages}
            isStreaming={wb.isStreaming}
            readiness={readinessUi}
            interrupted={wb.interrupted}
            suggestions={wb.suggestions}
            completionMeta={wb.completionMeta}
            promptValue={composer}
            setPromptValue={setComposer}
            onSubmit={handleSubmit}
            onSendMessage={sendMessage}
            onCommission={() => wb.commission()}
            onStop={() => wb.abort()}
            onEditMessage={(id) => {
              const r = wb.editMessage(id);
              if (r) setComposer(r.content);
            }}
            isCommissioning={wb.isCommissioning}
            selectedModel={wb.selectedModel}
            onModelChange={wb.setSelectedModel}
            attachedToolIds={wb.attachedToolIds}
            onAttachTool={(id) => wb.setAttachedToolIds((prev) => [...prev, id])}
            onDetachTool={(id) => wb.setAttachedToolIds((prev) => prev.filter((x) => x !== id))}
            canCommission={canCommission && !wb.commissionResult}
            onReset={() => {
              wb.reset();
              router.push(AGENTS_WORKBENCH_HREF);
            }}
            assumptionLedger={wb.assumptionLedger}
            classSuggestion={wb.classSuggestion}
            sessionId={wb.sessionId}
            onConfirmAssumption={wb.onConfirmAssumption}
            onEditAssumption={wb.onEditAssumption}
            onApplyClass={wb.onApplyClass}
            onDismissClassSuggestion={() => wb.setClassSuggestion(null)}
          />
        </div>
        <div style={{ width: '42%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {showDeveloperTab && (
            <div style={{ display: 'flex', borderBottom: '1px solid var(--wb-border-subtle)', flexShrink: 0 }}>
              {(['config', 'developer'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setRightPane(tab)}
                  style={{
                    ...type.label,
                    flex: 1,
                    height: 32,
                    border: 'none',
                    borderBottom: rightPane === tab ? `2px solid ${GOLD}` : '2px solid transparent',
                    background: 'transparent',
                    color: rightPane === tab ? GOLD : 'var(--wb-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {tab === 'config' ? 'Config' : 'Developer'}
                </button>
              ))}
            </div>
          )}
          {rightPane === 'developer' && showDeveloperTab ? (
            <DeveloperPane
              sessionId={wb.sessionId}
              messages={wb.messages}
              isStreaming={wb.isStreaming}
              selectedModel={wb.selectedModel}
              surface="workbench"
            />
          ) : (
            <ConfigPanel
              state={draftState}
              readiness={wb.readiness}
              commissionResult={wb.commissionResult}
              sessionId={wb.sessionId}
              isStreaming={wb.isStreaming}
              isCommissioning={wb.isCommissioning}
              canCommission={canCommission && !wb.commissionResult}
              selectedModel={wb.selectedModel}
              onEditField={wb.editField}
              onCommission={() => wb.commission()}
              onTestRunRecorded={wb.recordTestRun}
            />
          )}
        </div>
      </div>

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentSessionId={wb.sessionId}
      />
    </div>
  );
}
