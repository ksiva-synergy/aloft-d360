'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X, Sparkles, Layers, Archive, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react';
import { GOLD, RULE_TYPE_COLORS, MONO, SERIF, BODY, ruleTypeColor } from '@/lib/foer/foer-tokens';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TraceNode {
  id: string;
  nodeType: string;
  payload: Record<string, unknown>;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
  fromNodeId: string | null;
  edgeType: string | null;
  depth: number;
}

interface TraceBullet {
  id: string;
  ruleText: string;
  ruleType: string;
  confidence: number;
  helpfulCount: number;
  harmfulCount: number;
  status: string;
  version: number;
  agentClass: string;
  rationale?: string | null;
  createdAt: string;
}

const NODE_COLORS: Record<string, string> = {
  ACTION:     '#5FA9AE',
  OUTCOME:    '#6F9DC4',
  CORRECTION: GOLD,
  SOURCE:     '#88B8A0',
  DEAD_END:   '#D9774B',
};

function nodeColor(type: string) { return NODE_COLORS[type] ?? '#8892A4'; }

function payloadSummary(payload: Record<string, unknown>): string {
  if (!payload) return '';
  const s = (payload.responseSummary ?? payload.toolName ?? payload.errorMessage ?? payload.notes ?? '') as string;
  if (!s) return '';
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
}

function ruleTypeLabel(rt: string) { return rt.replace(/_/g, ' '); }

// ── Learned outcome categories ────────────────────────────────────────────────

const LEARNED_GREEN  = '#22c55e';
const LEARNED_STEEL  = '#6F9DC4';
const LEARNED_MUTED  = '#8892A4';
const PHANTOM_AMBER  = '#d9774b';

// ── Bullet card (shared for new + reinforced + forgotten) ─────────────────────

function BulletCard({ bullet, dimmed = false }: { bullet: TraceBullet; dimmed?: boolean }) {
  const [open, setOpen] = useState(false);
  const accent = ruleTypeColor(bullet.ruleType);
  return (
    <div
      onClick={() => setOpen(v => !v)}
      style={{
        borderLeft:   `3px solid ${dimmed ? LEARNED_MUTED : accent}`,
        padding:      '0.6rem 0.9rem',
        cursor:       'pointer',
        opacity:      dimmed ? 0.55 : 1,
        transition:   'background 0.12s',
        borderBottom: '1px solid var(--foer-border-dim)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--foer-surface2)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: '0.58rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: accent, background: `${accent}12`, border: `1px solid ${accent}35`, borderRadius: 3, padding: '1px 4px', whiteSpace: 'nowrap' }}>
          {ruleTypeLabel(bullet.ruleType)}
        </span>
        <span style={{ fontFamily: MONO, fontSize: '0.58rem', color: 'var(--foer-text-mut)' }}>
          {(bullet.confidence * 100).toFixed(0)}% conf
        </span>
        {bullet.version > 1 && (
          <span style={{ fontFamily: MONO, fontSize: '0.58rem', color: LEARNED_STEEL, background: `${LEARNED_STEEL}14`, border: `1px solid ${LEARNED_STEEL}35`, borderRadius: 3, padding: '1px 4px' }}>
            v{bullet.version}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {bullet.helpfulCount > 0 && (
          <span style={{ fontFamily: MONO, fontSize: '0.55rem', color: LEARNED_GREEN }}>
            ↑{bullet.helpfulCount}
          </span>
        )}
        {(bullet.harmfulCount ?? 0) > 0 && (
          <span style={{ fontFamily: MONO, fontSize: '0.55rem', color: RULE_TYPE_COLORS.FAILURE_MODE }}>
            ↓{bullet.harmfulCount}
          </span>
        )}
      </div>
      <p style={{ fontFamily: BODY, fontSize: '0.78rem', color: 'var(--foer-text-pri)', lineHeight: 1.5, margin: 0 }}>
        {open ? bullet.ruleText : (bullet.ruleText.length > 110 ? bullet.ruleText.slice(0, 110) + '…' : bullet.ruleText)}
      </p>
      {open && bullet.rationale && (
        <p style={{ fontFamily: SERIF, fontSize: '0.70rem', fontStyle: 'italic', color: 'var(--foer-text-sec)', lineHeight: 1.45, margin: '0.4rem 0 0', paddingTop: '0.4rem', borderTop: '1px solid var(--foer-border-dim)' }}>
          {bullet.rationale}
        </p>
      )}
    </div>
  );
}

// ── Learned category block ────────────────────────────────────────────────────

interface LearnedCategoryProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  accent: string;
  description: string;
  bullets: TraceBullet[];
  dimmed?: boolean;
  defaultOpen?: boolean;
}

function LearnedCategory({ icon, label, count, accent, description, bullets, dimmed = false, defaultOpen = true }: LearnedCategoryProps) {
  const [open, setOpen] = useState(defaultOpen && bullets.length > 0);

  if (count === 0 && bullets.length === 0) return null;

  return (
    <div style={{ border: `1px solid ${accent}28`, borderRadius: 6, overflow: 'hidden', marginBottom: '0.75rem' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: '0.75rem 1rem',
          background: `${accent}0c`,
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          outline: 'none',
        }}
      >
        <span style={{ color: accent, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{ fontFamily: MONO, fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em', color: accent, textTransform: 'uppercase' }}>
          {label}
        </span>
        <span style={{ fontFamily: MONO, fontSize: '1.1rem', fontWeight: 700, color: accent, marginLeft: '2px', lineHeight: 1 }}>
          {count}
        </span>
        <span style={{ flex: 1, fontFamily: MONO, fontSize: '0.6rem', color: 'var(--foer-text-mut)', letterSpacing: '0.02em' }}>
          {description}
        </span>
        {bullets.length > 0 && (
          <span style={{ color: 'var(--foer-text-mut)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </button>

      {open && bullets.length > 0 && (
        <div style={{ borderTop: `1px solid ${accent}20` }}>
          {bullets.map(b => <BulletCard key={b.id} bullet={b} dimmed={dimmed} />)}
        </div>
      )}

      {open && bullets.length === 0 && count > 0 && (
        <div style={{ padding: '0.6rem 1rem', fontFamily: MONO, fontSize: '0.62rem', color: 'var(--foer-text-mut)', borderTop: `1px solid ${accent}20` }}>
          {count} {count === 1 ? 'memory' : 'memories'} — detail records not retained in this view
        </div>
      )}
    </div>
  );
}

// ── Trace node row (vertical timeline) ───────────────────────────────────────

function TraceNodeRow({ node, isLast }: { node: TraceNode; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const c = nodeColor(node.nodeType);
  const summary = payloadSummary(node.payload);
  const tokTotal = (node.tokensIn ?? 0) + (node.tokensOut ?? 0);

  return (
    <div style={{ display: 'flex', gap: '0.75rem', paddingBottom: isLast ? 0 : '0.1rem' }}>
      {/* Timeline gutter */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 20, paddingTop: '0.6rem' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: c, border: `2px solid ${c}`, flexShrink: 0 }} />
        {!isLast && <div style={{ flex: 1, width: 1, background: 'var(--foer-border-dim)', marginTop: 3, minHeight: 16 }} />}
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          padding:      '0.5rem 0.75rem',
          cursor:       summary ? 'pointer' : 'default',
          borderRadius: 6,
          marginBottom: isLast ? 0 : '0.25rem',
          transition:   'background 0.12s',
          border:       '1px solid transparent',
        }}
        onMouseEnter={e => {
          if (summary) {
            (e.currentTarget as HTMLElement).style.background = 'var(--foer-surface2)';
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--foer-border-dim)';
          }
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
          (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
        }}
        onClick={() => summary && setOpen(v => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{ fontFamily: MONO, fontSize: '0.58rem', fontWeight: 600, color: c, background: `${c}14`, border: `1px solid ${c}35`, borderRadius: 3, padding: '1px 4px', whiteSpace: 'nowrap' }}>
            {node.nodeType}
          </span>
          {node.edgeType && (
            <span style={{ fontFamily: MONO, fontSize: '0.55rem', color: 'var(--foer-text-mut)' }}>
              via {node.edgeType.replace(/_/g, ' ').toLowerCase()}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {tokTotal > 0 && (
            <span style={{ fontFamily: MONO, fontSize: '0.55rem', color: 'var(--foer-text-mut)' }}>
              {tokTotal}t
            </span>
          )}
          {summary && (
            <span style={{ color: 'var(--foer-text-mut)', display: 'flex', alignItems: 'center' }}>
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          )}
        </div>
        {summary && (
          <p style={{ fontFamily: BODY, fontSize: '0.72rem', color: open ? 'var(--foer-text-pri)' : 'var(--foer-text-sec)', lineHeight: 1.45, margin: '0.25rem 0 0', wordBreak: 'break-word' }}>
            {open
              ? String(
                  node.payload?.responseSummary ?? node.payload?.toolName ?? node.payload?.errorMessage ?? node.payload?.notes ?? ''
                )
              : summary}
          </p>
        )}
        {open && node.nodeType === 'ACTION' && node.payload?.toolParams != null ? (
          <pre style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--foer-text-sec)', background: 'var(--foer-surface2)', borderRadius: 4, padding: '0.4rem', marginTop: '0.35rem', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(node.payload.toolParams, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

interface SessionDetailDrawerProps {
  sessionId: string | null;
  sessionLabel?: string;
  topicName?: string;
  candidatesProduced?: number;
  bulletsInserted?: number;
  bulletsDeduped?: number;
  phantomsBlocked?: number;
  onClose: () => void;
}

export function SessionDetailDrawer({
  sessionId,
  sessionLabel,
  topicName,
  candidatesProduced,
  bulletsInserted,
  bulletsDeduped,
  phantomsBlocked,
  onClose,
}: SessionDetailDrawerProps) {
  const isOpen = !!sessionId;
  const [traceOpen, setTraceOpen] = useState(false);

  const { data, isLoading } = useQuery<{ trace: TraceNode[]; bullets: TraceBullet[]; supersededBullets: TraceBullet[] }>({
    queryKey: ['foer-session-trace', sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/agent-lab/memory/trace/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!sessionId,
    staleTime: 120_000,
  });

  // Reset trace open state when a new session is opened
  useEffect(() => {
    if (isOpen) setTraceOpen(false);
  }, [isOpen, sessionId]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  const trace            = data?.trace             ?? [];
  const bullets          = data?.bullets           ?? [];
  const supersededBullets = data?.supersededBullets ?? [];

  // Categorise active bullets by version
  const newBullets        = bullets.filter(b => b.version === 1);
  const reinforcedBullets = bullets.filter(b => b.version > 1);

  // Counts from parent props (authoritative — bullets API may be filtered)
  const countNew        = bulletsInserted ?? newBullets.length;
  const countReinforced = bulletsDeduped  ?? reinforcedBullets.length;
  const countForgotten  = supersededBullets.length;
  const countPhantoms   = phantomsBlocked ?? 0;

  const totalTokens = trace.reduce((acc, n) => acc + (n.tokensIn ?? 0) + (n.tokensOut ?? 0), 0);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position:      'fixed',
          inset:         0,
          background:    'rgba(5,9,15,0.55)',
          zIndex:        40,
          opacity:       isOpen ? 1 : 0,
          transition:    'opacity 220ms ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position:      'fixed',
          top:           0,
          right:         0,
          bottom:        0,
          width:         560,
          background:    'var(--foer-surface)',
          borderLeft:    '1px solid var(--foer-border)',
          zIndex:        50,
          transform:     isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition:    'transform 240ms cubic-bezier(0.22,1,0.36,1)',
          display:       'flex',
          flexDirection: 'column',
          overflow:      'hidden',
        }}
      >
        {/* ── STICKY HEADER ── */}
        <div style={{
          padding:      '16px 20px 14px',
          borderBottom: '1px solid var(--foer-border)',
          background:   'var(--foer-surface)',
          flexShrink:   0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: 'var(--foer-text-pri)', fontWeight: 600, letterSpacing: '0.04em' }}>
                  {sessionLabel ?? sessionId?.slice(0, 8) ?? '—'}
                </span>
                {topicName && (
                  <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: GOLD, background: `${GOLD}12`, border: `1px solid ${GOLD}30`, borderRadius: 3, padding: '1px 6px' }}>
                    {topicName}
                  </span>
                )}
              </div>
              {/* Stat chips */}
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '0.62rem', color: 'var(--foer-text-mut)' }}>
                {candidatesProduced !== undefined && (
                  <span><span style={{ color: 'var(--foer-text-sec)' }}>{candidatesProduced}</span> candidates</span>
                )}
                <span><span style={{ color: LEARNED_GREEN, fontWeight: 600 }}>{countNew}</span> new</span>
                <span><span style={{ color: LEARNED_STEEL, fontWeight: 600 }}>{countReinforced}</span> reinforced</span>
                {countForgotten > 0 && (
                  <span><span style={{ color: LEARNED_MUTED }}>{countForgotten}</span> forgotten</span>
                )}
                {countPhantoms > 0 && (
                  <span><span style={{ color: PHANTOM_AMBER, fontWeight: 600 }}>{countPhantoms}</span> phantoms</span>
                )}
                {trace.length > 0 && (
                  <span><span style={{ color: 'var(--foer-text-sec)' }}>{trace.length}</span> trace nodes{totalTokens > 0 ? ` · ${totalTokens}t` : ''}</span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'var(--foer-surface2)', border: '1px solid var(--foer-border)', color: 'var(--foer-text-mut)', cursor: 'pointer', padding: '5px 7px', borderRadius: 6, lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--foer-text-pri)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--foer-text-mut)'; }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--foer-border) transparent' }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3.5rem', gap: '0.6rem', fontFamily: MONO, fontSize: '0.72rem', color: 'var(--foer-text-sec)' }}>
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite', color: GOLD }} />
              Loading session…
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', padding: '20px 20px 32px' }}>

              {/* ── SECTION: WHAT WAS LEARNED ── */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '15px', color: 'var(--foer-text-pri)' }}>What Was Learned</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--foer-border-dim)' }} />
                </div>

                {/* New */}
                <LearnedCategory
                  icon={<Sparkles size={14} />}
                  label="New"
                  count={countNew}
                  accent={LEARNED_GREEN}
                  description="first-time memories created from this session"
                  bullets={newBullets}
                  defaultOpen={true}
                />

                {/* Reinforced */}
                <LearnedCategory
                  icon={<Layers size={14} />}
                  label="Reinforced"
                  count={countReinforced}
                  accent={LEARNED_STEEL}
                  description="existing memories confirmed by matching pattern"
                  bullets={reinforcedBullets}
                  defaultOpen={true}
                />

                {/* Forgotten */}
                <LearnedCategory
                  icon={<Archive size={14} />}
                  label="Forgotten"
                  count={countForgotten}
                  accent={LEARNED_MUTED}
                  description="older versions superseded by stronger evidence"
                  bullets={supersededBullets}
                  dimmed={true}
                  defaultOpen={false}
                />

                {/* Empty state — nothing learned */}
                {countNew === 0 && countReinforced === 0 && countForgotten === 0 && (
                  <div style={{ padding: '1.5rem', textAlign: 'center', fontFamily: MONO, fontSize: '0.68rem', color: 'var(--foer-text-mut)', border: '1px dashed var(--foer-border-dim)', borderRadius: 6 }}>
                    No memories were written for this session.
                  </div>
                )}
              </div>

              {/* ── SECTION: PHANTOMS BLOCKED ── */}
              {countPhantoms > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                    <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '15px', color: 'var(--foer-text-pri)' }}>Phantoms Blocked</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--foer-border-dim)' }} />
                  </div>
                  <div style={{ border: `1px solid ${PHANTOM_AMBER}35`, borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.9rem 1rem', background: `${PHANTOM_AMBER}0a` }}>
                      <ShieldAlert size={18} style={{ color: PHANTOM_AMBER, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: MONO, fontSize: '0.68rem', fontWeight: 600, color: PHANTOM_AMBER, letterSpacing: '0.05em', marginBottom: '3px' }}>
                          {countPhantoms} PHANTOM{countPhantoms !== 1 ? 'S' : ''} REJECTED
                        </div>
                        <div style={{ fontFamily: BODY, fontSize: '0.72rem', color: 'var(--foer-text-sec)', lineHeight: 1.4 }}>
                          Candidate memories blocked — low confidence, contradictory evidence, or already superseded by a stronger rule.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION: SESSION TRACE (collapsible) ── */}
              {trace.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setTraceOpen(v => !v)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'transparent',
                      border: 'none',
                      padding: '0 0 14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      outline: 'none',
                    }}
                  >
                    <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '15px', color: 'var(--foer-text-pri)' }}>Session Trace</span>
                    <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--foer-text-mut)', letterSpacing: '0.04em' }}>
                      {trace.length} nodes
                    </span>
                    <div style={{ flex: 1, height: 1, background: 'var(--foer-border-dim)' }} />
                    <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: 'var(--foer-text-mut)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      {traceOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {traceOpen ? 'hide' : 'show'}
                    </span>
                  </button>

                  {traceOpen && (
                    <div style={{ paddingLeft: '4px' }}>
                      {trace.map((node, idx) => (
                        <TraceNodeRow key={node.id} node={node} isLast={idx === trace.length - 1} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Empty state */}
              {trace.length === 0 && countNew === 0 && countReinforced === 0 && countForgotten === 0 && !isLoading && (
                <div style={{ padding: '3rem', textAlign: 'center', fontFamily: MONO, fontSize: '0.72rem', color: 'var(--foer-text-mut)' }}>
                  No trace data for this session.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
