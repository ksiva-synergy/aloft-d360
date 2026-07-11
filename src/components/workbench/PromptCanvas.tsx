'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, Pencil, ChevronDown, Octagon } from 'lucide-react';
import type { WorkbenchMessage } from '@/components/agent-lab/workbench/types';
import { StreamingMessage } from './StreamingMessage';
import { InputComposer } from './InputComposer';
import { AssumptionChip } from './AssumptionChip';
import { ClassSuggestionChip } from './ClassSuggestionChip';
import type { AssumptionLedgerEntry } from '@/lib/construction/assumptionHelpers';
import { useReflections } from './marcus/useReflections';
import type { Reflection } from './marcus/useReflections';
import { ReflectionCard } from './marcus/ReflectionCard';
import { DismissedReflection } from './marcus/DismissedReflection';

// ── Constants ─────────────────────────────────────────────────
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const sans: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };
const GOLD = '#FDB515';
const MUTED = 'var(--wb-muted)';
const INK = 'var(--wb-ink)';
const INK_DIM = 'var(--wb-ink-dim)';
const CANVAS = 'var(--wb-canvas)';
const SURFACE = 'var(--wb-surface)';
const BORDER_SUBTLE = 'var(--wb-border-subtle)';
const BORDER_GOLD = 'rgba(253,181,21,0.30)';
const RED = '#ef4444';

// ── Mission templates ─────────────────────────────────────────
const MISSION_TEMPLATES = [
  {
    cls: 'FEYNMAN',
    name: 'Maritime compliance auditor',
    spec: 'Audit bills of lading against IMO rules; flag missing HS codes.',
    starter: 'Build a Feynman-class agent called "BoL Compliance Auditor". Mission: audit bills of lading against IMO FAL Form rules and flag missing or non-compliant HS codes. Output: a structured JSON audit memo with a violations array and a pass/fail verdict.',
  },
  {
    cls: 'FERMI',
    name: 'Demand forecasting agent',
    spec: 'Weekly SKU-level forecast across 14 warehouses with confidence bands.',
    starter: 'Build a Fermi-class agent called "SKU Demand Forecaster". Mission: produce weekly SKU-level demand forecasts across 14 warehouses. Output: structured JSON with point estimate, 80% confidence interval, and assumption list per SKU.',
  },
  {
    cls: 'GROSSMANN',
    name: 'Vendor onboarding pipeline',
    spec: 'Intake → KYC → Stripe Connect → first invoice within 24h.',
    starter: 'Build a Grossmann-class agent called "Vendor Onboarding Orchestrator". Mission: automate vendor onboarding end to end within 24 hours. Output: a JSON status record per vendor with step timestamps and any blockers.',
  },
];

// ── Diamond logo ──────────────────────────────────────────────
function AloftDiamond({ size = 72, opacity = 0.18 }: { size?: number; opacity?: number }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', opacity, flexShrink: 0 }}>
      <div style={{ position: 'absolute', inset: 0, border: '1.5px solid #FDB515', transform: 'rotate(45deg)' }} />
      <div style={{ position: 'absolute', inset: Math.round(size * 0.27), border: '1.5px solid #FDB515', transform: 'rotate(45deg)', opacity: 0.6 }} />
    </div>
  );
}

// ── Blinking caret ────────────────────────────────────────────
function BlinkCaret() {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 13,
      background: GOLD, marginLeft: 2,
      transform: 'translateY(2px)',
      animation: 'pc-blink 1.1s steps(1) infinite',
      flexShrink: 0,
    }} />
  );
}

// ── Empty state ───────────────────────────────────────────────
interface EmptyStateProps {
  onTemplateSelect: (starter: string) => void;
}
function EmptyState({ onTemplateSelect }: EmptyStateProps) {
  const [templatesOpen, setTemplatesOpen] = useState(false);

  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, overflow: 'hidden auto', minHeight: 0 }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, maxWidth: 480 }}
      >
        <AloftDiamond size={72} opacity={0.18} />
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ ...mono, color: MUTED, fontSize: 13, letterSpacing: '0.04em', display: 'flex', alignItems: 'center' }}>
            Describe your agent mission<BlinkCaret />
          </div>
          <button
            onClick={() => setTemplatesOpen(o => !o)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', ...mono, fontSize: 10, color: templatesOpen ? GOLD : MUTED, letterSpacing: '0.04em', padding: '2px 0', transition: 'color 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.color = templatesOpen ? GOLD : MUTED; }}
          >
            · or start from a template
          </button>
        </div>
        <div style={{ ...mono, fontSize: 10, color: MUTED, letterSpacing: '0.5em', textTransform: 'uppercase', opacity: 0.5 }}>ALOFT</div>
        <AnimatePresence>
          {templatesOpen && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}
            >
              {MISSION_TEMPLATES.map((t) => (
                <button
                  key={t.cls} type="button"
                  onClick={() => { onTemplateSelect(t.starter); setTemplatesOpen(false); }}
                  style={{ textAlign: 'left', padding: '10px 14px', background: SURFACE, border: `1px solid ${BORDER_SUBTLE}`, borderRadius: 8, cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = BORDER_GOLD; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER_SUBTLE; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                    <span style={{ ...mono, fontSize: 9, color: GOLD, borderLeft: `2px solid ${GOLD}`, paddingLeft: 7, letterSpacing: '0.1em' }}>{t.cls}</span>
                    <span style={{ ...sans, fontSize: 12, color: INK }}>{t.name}</span>
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: MUTED, paddingLeft: 17 }}>{t.spec}</div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ── Interrupted banner ────────────────────────────────────────
function InterruptedBanner({ onContinue, onReset }: { onContinue: () => void; onReset: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 20px',
        background: 'rgba(239,68,68,0.06)',
        borderBottom: '1px solid rgba(239,68,68,0.18)',
        flexShrink: 0,
      }}
    >
      <Octagon size={13} style={{ color: RED, flexShrink: 0 }} />
      <span style={{ ...mono, fontSize: 11, color: 'rgba(239,68,68,0.85)', flex: 1 }}>Generation stopped</span>
      <button
        onClick={onContinue}
        style={{
          ...mono, fontSize: 11, color: GOLD, background: 'rgba(253,181,21,0.08)',
          border: '1px solid rgba(253,181,21,0.25)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(253,181,21,0.14)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(253,181,21,0.08)'; }}
      >
        Continue ↵
      </button>
      <button
        onClick={onReset}
        style={{
          ...mono, fontSize: 11, color: MUTED, background: 'transparent',
          border: '1px solid rgba(74,96,128,0.3)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer',
          transition: 'color 0.15s, border-color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = INK_DIM; e.currentTarget.style.borderColor = 'rgba(174,185,199,0.4)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.borderColor = 'rgba(74,96,128,0.3)'; }}
      >
        Start over
      </button>
    </motion.div>
  );
}

// ── Suggestion pills ──────────────────────────────────────────
function SuggestionPills({ suggestions, onSelect }: { suggestions: string[]; onSelect: (s: string) => void }) {
  if (suggestions.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 20px 4px' }}
    >
      {suggestions.map(s => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          style={{
            ...mono, fontSize: 11, color: INK_DIM,
            background: SURFACE, border: `1px solid ${BORDER_SUBTLE}`,
            borderRadius: 20, padding: '5px 14px', cursor: 'pointer',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = BORDER_GOLD; e.currentTarget.style.color = INK; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER_SUBTLE; e.currentTarget.style.color = INK_DIM; }}
        >
          {s}
        </button>
      ))}
    </motion.div>
  );
}

// ── User message bubble ───────────────────────────────────────
interface UserMessageProps {
  msg: WorkbenchMessage;
  onResend: (content: string) => void;
  onEdit: (id: string) => void;
}
function UserMessage({ msg, onResend, onEdit }: UserMessageProps) {
  const [hovered, setHovered] = useState(false);
  const ts = new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ borderLeft: `2px solid ${GOLD}`, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <div style={{ ...mono, fontSize: 13, color: INK, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
        {msg.content}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AnimatePresence>
            {hovered && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.15 }}
                style={{ display: 'flex', gap: 4 }}
              >
                <button
                  onClick={() => onEdit(msg.id)}
                  title="Edit and resend"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    ...mono, fontSize: 10, color: MUTED,
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px',
                    borderRadius: 4, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
                  onMouseLeave={e => { e.currentTarget.style.color = MUTED; }}
                >
                  <Pencil size={10} /> Edit
                </button>
                <button
                  onClick={() => onResend(msg.content)}
                  title="Resend"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    ...mono, fontSize: 10, color: MUTED,
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px',
                    borderRadius: 4, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = INK_DIM; }}
                  onMouseLeave={e => { e.currentTarget.style.color = MUTED; }}
                >
                  <RotateCcw size={10} /> Resend
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div style={{ ...mono, fontSize: 10, color: MUTED }}>{ts}</div>
      </div>
    </motion.div>
  );
}

// ── Scroll-to-bottom pill ─────────────────────────────────────
function ScrollToBottomPill({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      onClick={onClick}
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        ...mono,
        fontSize: 11,
        color: INK_DIM,
        background: SURFACE,
        border: `1px solid ${BORDER_GOLD}`,
        borderRadius: 20,
        padding: '6px 14px',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        zIndex: 10,
        whiteSpace: 'nowrap',
      }}
    >
      New content below <ChevronDown size={12} />
    </motion.button>
  );
}

// ── Conversation thread ───────────────────────────────────────
interface ConversationThreadProps {
  messages: WorkbenchMessage[];
  isStreaming: boolean;
  readiness: 'interview' | 'plan' | 'build' | null;
  suggestions: string[];
  interrupted: boolean;
  completionMeta: Record<string, { durationMs: number; tokenCount: number; modelName: string }>;
  onSend: (content: string) => void;
  onEditMessage: (id: string) => void;
  onReset: () => void;
  // Chip props (R5)
  assumptionLedger?: AssumptionLedgerEntry[];
  classSuggestion?: { classId: string; confidence: number; rationale: string } | null;
  sessionId?: string | null;
  onConfirmAssumption?: (field: string) => void;
  onEditAssumption?: (field: string, newValue: string) => void;
  onApplyClass?: (updatedClass: unknown, updatedMemory: unknown) => void;
  onDismissClassSuggestion?: () => void;
  // Reflection props
  reflections?: Reflection[];
  dismissedReflections?: Map<string, { technique: string; summary: string }>;
  onDismissReflection?: (id: string) => void;
  onAcknowledgeReflection?: (id: string) => void;
  onActReflection?: (id: string, action: any) => void;
  onRestoreReflection?: (id: string) => void;
}

function ConversationThread({
  messages, isStreaming, readiness,
  suggestions, interrupted, completionMeta,
  onSend, onEditMessage, onReset,
  assumptionLedger = [],
  classSuggestion = null,
  sessionId = null,
  onConfirmAssumption,
  onEditAssumption,
  onApplyClass,
  onDismissClassSuggestion,
  reflections = [],
  dismissedReflections = new Map(),
  onDismissReflection,
  onAcknowledgeReflection,
  onActReflection,
  onRestoreReflection,
}: ConversationThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const prevLengthRef = useRef(messages.length);

  // Track which ledger entries have been "seen" by each message.
  // We use the last-assistant-message's index as the anchor: entries appended
  // after the prior assistant turn and up to the current one are shown below it.
  // We snapshot the ledger count per assistant message id to diff it.
  const ledgerSnapshotRef = useRef<Record<string, number>>({});

  // Track whether user has scrolled away from the bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distFromBottom > 120);

  }, []);

  // Auto-scroll only when near bottom and new content arrives
  useEffect(() => {
    const newContent = messages.length !== prevLengthRef.current || isStreaming;
    prevLengthRef.current = messages.length;
    if (!userScrolledUp && newContent) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isStreaming, userScrolledUp]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUserScrolledUp(false);
  };

  const lastAssistantIdx = messages.reduce((acc, m, i) => m.role === 'assistant' ? i : acc, -1);
  const visible = messages.filter((msg, i) => {
    if (msg.content || msg.thinking || (msg.toolCalls && msg.toolCalls.length > 0)) return true;
    if (msg.role === 'assistant' && isStreaming && i === lastAssistantIdx) return true;
    return false;
  });

  // Build a map of assistant message index → assumption entries that appeared
  // "during" that turn. We snapshot the ledger count when each completed
  // assistant message is first rendered, then diff on re-render.
  // Entries since the prior snapshot are attributed to that message.
  const assistantMsgs = visible.filter((m) => m.role === 'assistant');
  const assumptionsByMsgId: Record<string, AssumptionLedgerEntry[]> = {};
  let prevCount = 0;
  for (let i = 0; i < assistantMsgs.length; i++) {
    const msgId = assistantMsgs[i].id;
    const snap = ledgerSnapshotRef.current[msgId];
    const nextSnap = i < assistantMsgs.length - 1
      ? (ledgerSnapshotRef.current[assistantMsgs[i + 1].id] ?? assumptionLedger.length)
      : assumptionLedger.length;
    if (snap === undefined) {
      ledgerSnapshotRef.current[msgId] = prevCount;
    }
    const from = snap ?? prevCount;
    const to = i === assistantMsgs.length - 1 ? assumptionLedger.length : nextSnap;
    assumptionsByMsgId[msgId] = assumptionLedger.slice(from, to);
    prevCount = to;
  }

  const handleContinue = () => onSend('Continue from where you left off.');
  const isLastAssistantMsg = (msg: WorkbenchMessage) =>
    assistantMsgs.length > 0 && assistantMsgs[assistantMsgs.length - 1].id === msg.id;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 28px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          minHeight: 0,
        }}
      >
        <AnimatePresence initial={false}>
          {visible.map((msg, idx) => {
            const isLast = idx === visible.length - 1;

            if (msg.role === 'user') {
              return (
                <UserMessage
                  key={msg.id}
                  msg={msg}
                  onResend={onSend}
                  onEdit={onEditMessage}
                />
              );
            }

            const originalIdx = messages.findIndex(m => m.id === msg.id);
            const turnReflections = reflections.filter(r => r.turnIndex === originalIdx);

            const isLiveStreaming = isStreaming && isLast;
            const msgAssumptions = assumptionsByMsgId[msg.id] ?? [];
            const showClassChip = !isStreaming && isLastAssistantMsg(msg) && !!classSuggestion;

            return (
              <React.Fragment key={msg.id}>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <StreamingMessage
                  content={msg.content}
                  thinking={msg.thinking}
                  toolCalls={msg.toolCalls}
                  isStreaming={isLiveStreaming}
                  interrupted={interrupted && isLast && !isStreaming}
                  readiness={isLast ? readiness : undefined}
                  timestamp={msg.timestamp}
                  durationMs={completionMeta[msg.id]?.durationMs}
                  tokenCount={completionMeta[msg.id]?.tokenCount}
                  modelName={completionMeta[msg.id]?.modelName}
                />
                {/* Assumption chips — shown after streaming completes */}
                {!isLiveStreaming && msgAssumptions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 2 }}>
                    {msgAssumptions.map((entry) => (
                      <AssumptionChip
                        key={entry.field}
                        entry={entry}
                        onConfirm={() => onConfirmAssumption?.(entry.field)}
                        onEdit={(newVal) => onEditAssumption?.(entry.field, newVal)}
                      />
                    ))}
                  </div>
                )}
                {/* Class suggestion chip — shown on the last assistant message */}
                {showClassChip && classSuggestion && (
                  <ClassSuggestionChip
                    classId={classSuggestion.classId}
                    confidence={classSuggestion.confidence}
                    rationale={classSuggestion.rationale}
                    sessionId={sessionId}
                    onApply={(c, m) => onApplyClass?.(c, m)}
                    onDismiss={() => onDismissClassSuggestion?.()}
                  />
                )}
              </motion.div>
              {turnReflections.map(ref => (
                dismissedReflections.has(ref.id)
                  ? <DismissedReflection
                      key={ref.id}
                      technique={dismissedReflections.get(ref.id)!.technique}
                      summary={dismissedReflections.get(ref.id)!.summary}
                      onExpand={() => onRestoreReflection?.(ref.id)}
                    />
                  : <ReflectionCard
                      key={ref.id}
                      {...ref}
                      onDismiss={(id) => onDismissReflection?.(id)}
                      onAcknowledge={(id) => onAcknowledgeReflection?.(id)}
                      onAct={(id, action) => onActReflection?.(id, action)}
                    />
              ))}
            </React.Fragment>
            );
          })}
        </AnimatePresence>

        {/* Trajectory-level reflections (no turnIndex) */}
        <AnimatePresence>
          {!isStreaming && reflections.filter(r => r.turnIndex == null).map(ref => (
            dismissedReflections.has(ref.id)
              ? <DismissedReflection
                  key={ref.id}
                  technique={dismissedReflections.get(ref.id)!.technique}
                  summary={dismissedReflections.get(ref.id)!.summary}
                  onExpand={() => onRestoreReflection?.(ref.id)}
                />
              : <ReflectionCard
                  key={ref.id}
                  {...ref}
                  onDismiss={(id) => onDismissReflection?.(id)}
                  onAcknowledge={(id) => onAcknowledgeReflection?.(id)}
                  onAct={(id, action) => onActReflection?.(id, action)}
                />
          ))}
        </AnimatePresence>

        {/* Suggestion pills right below the last message */}
        <AnimatePresence>
          {!isStreaming && suggestions.length > 0 && (
            <SuggestionPills
              suggestions={suggestions}
              onSelect={s => {
                if (s === 'Start over') { onReset(); return; }
                if (s === 'Continue from here') { handleContinue(); return; }
                onSend(s);
              }}
            />
          )}
        </AnimatePresence>

        <div ref={bottomRef} style={{ height: 8 }} />
      </div>

      {/* Scroll-to-bottom pill */}
      <AnimatePresence>
        {userScrolledUp && isStreaming && (
          <ScrollToBottomPill onClick={scrollToBottom} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── PromptCanvas (main export) ────────────────────────────────
export interface PromptCanvasProps {
  messages: WorkbenchMessage[];
  isStreaming: boolean;
  readiness?: 'interview' | 'plan' | 'build' | null;
  interrupted?: boolean;
  suggestions?: string[];
  completionMeta?: Record<string, { durationMs: number; tokenCount: number; modelName: string }>;
  promptValue: string;
  setPromptValue: (v: string) => void;
  onSubmit: () => void;
  onCommission?: () => void;
  onStop?: () => void;
  onReset?: () => void;
  onEditMessage?: (messageId: string) => void;
  isCommissioning: boolean;
  selectedModel: string;
  onModelChange: (v: string) => void;
  attachedToolIds?: string[];
  onAttachTool?: (id: string) => void;
  onDetachTool?: (id: string) => void;
  /** Passed through to InputComposer — gates the COMMISSION button. */
  canCommission?: boolean;
  // Assumption + class suggestion chips (R5)
  assumptionLedger?: AssumptionLedgerEntry[];
  classSuggestion?: { classId: string; confidence: number; rationale: string } | null;
  sessionId?: string | null;
  onConfirmAssumption?: (field: string) => void;
  onEditAssumption?: (field: string, newValue: string) => void;
  onApplyClass?: (updatedClass: unknown, updatedMemory: unknown) => void;
  onDismissClassSuggestion?: () => void;
}

export function PromptCanvas({
  messages,
  isStreaming,
  readiness = null,
  interrupted = false,
  suggestions = [],
  completionMeta = {},
  promptValue,
  setPromptValue,
  onSubmit,
  onCommission,
  onStop,
  onReset,
  onEditMessage,
  isCommissioning,
  selectedModel,
  onModelChange,
  attachedToolIds = [],
  onAttachTool,
  onDetachTool,
  canCommission = true,
  assumptionLedger = [],
  classSuggestion = null,
  sessionId = null,
  onConfirmAssumption,
  onEditAssumption,
  onApplyClass,
  onDismissClassSuggestion,
}: PromptCanvasProps) {
  const hasMessages = messages.some(m => m.content || m.thinking || (m.toolCalls && m.toolCalls.length > 0));

  const { reflections, dismissed, dismiss, acknowledge, act, restoreReflection } = useReflections(sessionId);

  const handleTemplateSelect = (starter: string) => {
    setPromptValue(starter);
    setTimeout(() => {
      if (starter.trim().length >= 10) onSubmit();
    }, 0);
  };

  const handleSend = (content: string) => {
    setPromptValue('');
    // Send via parent's submit after setting value
    // Use a small trick: pre-populate then trigger
    setPromptValue(content);
    setTimeout(onSubmit, 0);
  };

  const handleEditMessage = (id: string) => {
    onEditMessage?.(id);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'hidden',
      background: CANVAS,
      minHeight: 0,
    }}>
      {/* Interrupt banner */}
      <AnimatePresence>
        {interrupted && !isStreaming && (
          <InterruptedBanner
            onContinue={() => handleSend('Continue from where you left off.')}
            onReset={() => onReset?.()}
          />
        )}
      </AnimatePresence>

      {/* Canvas body */}
      {!hasMessages ? (
        <EmptyState onTemplateSelect={handleTemplateSelect} />
      ) : (
        <ConversationThread
          messages={messages}
          isStreaming={isStreaming}
          readiness={readiness}
          suggestions={suggestions}
          interrupted={interrupted}
          completionMeta={completionMeta}
          onSend={handleSend}
          onEditMessage={handleEditMessage}
          onReset={() => onReset?.()}
          assumptionLedger={assumptionLedger}
          classSuggestion={classSuggestion}
          sessionId={sessionId}
          onConfirmAssumption={onConfirmAssumption}
          onEditAssumption={onEditAssumption}
          onApplyClass={onApplyClass}
          onDismissClassSuggestion={onDismissClassSuggestion}
          reflections={reflections}
          dismissedReflections={dismissed}
          onDismissReflection={dismiss}
          onAcknowledgeReflection={acknowledge}
          onActReflection={act}
          onRestoreReflection={restoreReflection}
        />
      )}

      {/* Next-step suggestion chips — visible above composer once streaming ends */}
      <AnimatePresence>
        {!isStreaming && !isCommissioning && suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              padding: '8px 16px 0',
              background: SURFACE,
              borderTop: `1px solid ${BORDER_SUBTLE}`,
            }}
          >
            <span style={{ ...mono, fontSize: 9, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', alignSelf: 'center', marginRight: 2 }}>
              Next →
            </span>
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => {
                  if (s === 'Start over') { onReset?.(); return; }
                  setPromptValue(s);
                  setTimeout(onSubmit, 0);
                }}
                style={{
                  ...mono,
                  fontSize: 11,
                  color: INK_DIM,
                  background: CANVAS,
                  border: `1px solid ${BORDER_SUBTLE}`,
                  borderRadius: 20,
                  padding: '4px 12px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, color 0.15s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = BORDER_GOLD; e.currentTarget.style.color = INK; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER_SUBTLE; e.currentTarget.style.color = INK_DIM; }}
              >
                {s}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Composer */}
      <InputComposer
        value={promptValue}
        onChange={setPromptValue}
        onSubmit={onSubmit}
        onCommission={onCommission}
        onStop={onStop}
        isStreaming={isStreaming}
        isCommissioning={isCommissioning}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
        attachedToolIds={attachedToolIds}
        onAttachTool={onAttachTool}
        onDetachTool={onDetachTool}
        canCommission={canCommission}
        placeholder="Describe your agent mission…"
        minLength={10}
      />

      <style>{`
        @keyframes pc-blink { 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}
