'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, SquarePen } from 'lucide-react';
import { PromptCanvas } from '@/components/workbench/PromptCanvas';
import { HistoryDrawer } from '@/components/workbench/HistoryDrawer';
import { ConfigPanel } from '@/components/workbench/ConfigPanel';
import { AloftSigil } from '@/components/workbench/atoms';
import { useWorkbenchChat } from '@/hooks/useWorkbenchChat';
import { canCommissionAgent } from '@/lib/construction/readiness';
import { emptyConstructionDraft } from '@/lib/construction/empty-draft';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const GOLD = '#FDB515';

export default function WorkbenchShell({ sessionId: initialSessionId }: { sessionId?: string } = {}) {
  const router = useRouter();
  const [composer, setComposer] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('New Session');

  const wb = useWorkbenchChat({
    sessionId: initialSessionId ?? null,
    onSessionCreated: (id) => {
      if (typeof window !== 'undefined' && window.location.pathname === '/agent-lab/workbench') {
        window.history.replaceState(null, '', `/agent-lab/workbench/${id}`);
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
          ...mono,
          fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--wb-muted)' }}>
          <AloftSigil size={14} />
          <span style={{ textTransform: 'uppercase', fontSize: 10 }}>DATA 360</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ textTransform: 'uppercase', fontSize: 10, color: GOLD }}>AGENT LAB</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ color: 'var(--wb-ink-dim)', fontSize: 10 }}>WORKBENCH</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ color: 'var(--wb-ink-dim)', fontSize: 10, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sessionTitle}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              wb.reset();
              setSessionTitle('New Session');
              router.push('/agent-lab/workbench');
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
              ...mono,
              fontSize: 9,
            }}
          >
            <SquarePen size={11} /> NEW
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
            ...mono,
            fontSize: 11,
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
              router.push('/agent-lab/workbench');
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
          <ConfigPanel
            state={draftState}
            readiness={wb.readiness}
            commissionResult={wb.commissionResult}
            sessionId={wb.sessionId}
          />
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
