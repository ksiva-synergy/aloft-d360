'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { GraduationCap, Plus, ArrowUpCircle, X, Tag, Ruler, MessageSquareText, Code2, ChevronDown } from 'lucide-react';
import type { AuthoringScope } from './scope';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const SANS: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };
const GOLD = '#FDB515';
const GREEN = '#22c55e';
const NAVY = '#003262';
const MUTED = '#8892A4';
const BLUE = '#93C5FD';
const BORDER = 'rgba(253,181,21,0.15)';
const SURFACE = 'rgba(255,255,255,0.03)';

interface ContribDefinition { id: string; kind: 'measure' | 'dimension'; label: string; status: string; nlIntent: string | null; }
interface ContribSynonym { defId: string; tableName: string; added: string[]; at: string; }
interface ContribRule { id: string; ruleText: string; ruleType: string; visibility: string; status: string; }
interface ContribChart { id: string; name: string; nlIntent: string | null; at: string; }
interface ContribData { definitions: ContribDefinition[]; synonyms: ContribSynonym[]; rules: ContribRule[]; charts: ContribChart[]; }

/**
 * "What I've taught" (Phase 3.5D, deliverable 5) + the coaching entry point
 * (deliverable 4). One place where the user watches their contributions climb
 * the ladder: metrics/dimensions authored, synonyms added, standing rules taught
 * (with add + promote-to-org + retire), and saved raw-SQL charts.
 *
 * Impact counters ("answered N questions") are deferred — the list is the MVP.
 */
export function WhatIveTaughtSection({ scope }: { scope: AuthoringScope }) {
  const [data, setData] = useState<ContribData | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // One session model's contributions, or the org-wide aggregate (W1). Same
  // response shape either way, so the rendering below is scope-agnostic.
  const feedUrl = scope.kind === 'model'
    ? `/api/inspector/semantic/${scope.modelId}/contributions`
    : `/api/inspector/semantic/my-contributions`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(feedUrl);
      if (res.ok) setData((await res.json()) as ContribData);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [feedUrl]);

  useEffect(() => { if (open && !data) load(); }, [open, data, load]);

  const total =
    (data?.definitions.length ?? 0) +
    (data?.synonyms.length ?? 0) +
    (data?.rules.length ?? 0) +
    (data?.charts.length ?? 0);

  return (
    <div style={{ marginBottom: 12, border: `1px solid ${BORDER}`, borderRadius: 6, background: SURFACE, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <GraduationCap size={14} color={GOLD} />
        <span style={{ ...MONO, fontSize: 11, letterSpacing: '0.06em', color: 'var(--wb-ink, #E6ECF5)', flex: 1 }}>
          WHAT I&apos;VE TAUGHT{open && data ? ` (${total})` : ''}
        </span>
        <ChevronDown size={13} color={MUTED} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{ padding: '4px 12px 12px', borderTop: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading && <span style={{ ...MONO, fontSize: 10, color: MUTED }}>Loading…</span>}

          {/* Coaching — teach a standing rule (deliverable 4) */}
          <RulesSubsection rules={data?.rules ?? []} onChanged={load} />

          {/* Definitions authored */}
          <Subsection icon={<Ruler size={11} color={GOLD} />} title="METRICS & DIMENSIONS" count={data?.definitions.length ?? 0}>
            {(data?.definitions ?? []).map((d) => (
              <Row key={`${d.kind}:${d.id}`} label={d.label} sub={d.nlIntent ?? d.kind} badge={d.status} badgeColor={d.status === 'governed' ? GREEN : GOLD} />
            ))}
          </Subsection>

          {/* Synonyms added */}
          <Subsection icon={<Tag size={11} color={BLUE} />} title="SYNONYMS ADDED" count={data?.synonyms.length ?? 0}>
            {(data?.synonyms ?? []).map((s, i) => (
              <Row key={`${s.defId}:${i}`} label={s.added.join(', ')} sub={s.tableName.replace('platform_sem_', '')} />
            ))}
          </Subsection>

          {/* Saved raw-SQL charts (deliverable 5 — with graduate nudge inherited from 3.5C) */}
          <Subsection icon={<Code2 size={11} color={MUTED} />} title="SAVED SQL CHARTS" count={data?.charts.length ?? 0}>
            {(data?.charts ?? []).map((c) => (
              <Row key={c.id} label={c.name} sub={c.nlIntent ?? 'raw SQL'} badge="RAW SQL" badgeColor={MUTED} />
            ))}
          </Subsection>
        </div>
      )}
    </div>
  );
}

// ── Rules subsection with add + promote + retire ──────────────────────────────

function RulesSubsection({ rules, onChanged }: { rules: ContribRule[]; onChanged: () => void }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRule = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/inspector/memory/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleText: text }),
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Failed'); }
      setInput('');
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }, [input, onChanged]);

  const promote = useCallback(async (id: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/inspector/memory/rules/${id}/promote`, { method: 'POST' });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Failed'); }
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }, [onChanged]);

  const retire = useCallback(async (id: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/inspector/memory/rules/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Failed'); }
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }, [onChanged]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <MessageSquareText size={11} color={GOLD} />
        <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', color: GOLD }}>RULES TAUGHT ({rules.length})</span>
      </div>

      {/* Teach a rule */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'flex-start' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Teach Inspector a rule — e.g. always exclude internal test accounts"
          rows={2}
          disabled={busy}
          style={{
            ...MONO, fontSize: 10, flex: 1, minWidth: 0, resize: 'vertical',
            background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(74,96,128,0.35)',
            borderRadius: 4, color: 'var(--wb-ink, #E6ECF5)', padding: '5px 8px', outline: 'none',
          }}
        />
        <button
          onClick={addRule}
          disabled={busy || !input.trim()}
          title="Teach this as a personal rule"
          style={{
            ...MONO, fontSize: 9, letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: 3,
            background: input.trim() && !busy ? GOLD : 'transparent', color: input.trim() && !busy ? NAVY : MUTED,
            border: `1px solid ${input.trim() && !busy ? GOLD : 'rgba(136,146,164,0.35)'}`,
            borderRadius: 4, padding: '5px 9px', cursor: input.trim() && !busy ? 'pointer' : 'default', flexShrink: 0,
          }}
        >
          <Plus size={10} /> TEACH
        </button>
      </div>
      {error && <span style={{ ...MONO, fontSize: 9, color: '#f43f5e' }}>{error}</span>}

      {/* Rules list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rules.length === 0 && (
          <span style={{ ...MONO, fontSize: 10, color: MUTED, fontStyle: 'italic' }}>No rules yet — teach one above.</span>
        )}
        {rules.map((r) => {
          const isOrg = r.visibility === 'org';
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 8px', border: `1px solid ${BORDER}`, borderRadius: 4, background: SURFACE }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...SANS, fontSize: 12, color: 'var(--wb-ink, #E6ECF5)', lineHeight: 1.4 }}>{r.ruleText}</div>
                <span style={{
                  ...MONO, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: isOrg ? GREEN : MUTED, border: `1px solid ${isOrg ? 'rgba(34,197,94,0.3)' : 'rgba(136,146,164,0.3)'}`,
                  borderRadius: 3, padding: '1px 5px', marginTop: 3, display: 'inline-block',
                }}>
                  {isOrg ? 'ORG-WIDE' : 'PERSONAL'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {!isOrg && (
                  <button
                    onClick={() => promote(r.id)}
                    disabled={busy}
                    title="Promote to org-wide (reputation-gated)"
                    style={{ ...MONO, fontSize: 8, display: 'inline-flex', alignItems: 'center', gap: 3, background: 'transparent', color: GOLD, border: `1px solid rgba(253,181,21,0.35)`, borderRadius: 3, padding: '2px 6px', cursor: busy ? 'default' : 'pointer' }}
                  >
                    <ArrowUpCircle size={10} /> PROMOTE
                  </button>
                )}
                <button
                  onClick={() => retire(r.id)}
                  disabled={busy}
                  title="Retire this rule"
                  style={{ display: 'inline-flex', background: 'transparent', border: 'none', color: MUTED, cursor: busy ? 'default' : 'pointer', padding: 2 }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────

function Subsection({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {icon}
        <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', color: MUTED }}>{title} ({count})</span>
      </div>
      {count === 0 ? (
        <span style={{ ...MONO, fontSize: 10, color: MUTED, fontStyle: 'italic', paddingLeft: 16 }}>none yet</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 16 }}>{children}</div>
      )}
    </div>
  );
}

function Row({ label, sub, badge, badgeColor }: { label: string; sub?: string; badge?: string; badgeColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...SANS, fontSize: 12, color: 'var(--wb-ink, #E6ECF5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        {sub && <div style={{ ...MONO, fontSize: 9, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      </div>
      {badge && (
        <span style={{ ...MONO, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: badgeColor ?? MUTED, flexShrink: 0 }}>{badge}</span>
      )}
    </div>
  );
}
