'use client';

/**
 * MemoryCredCard — compact dashboard section for the per-domain memory-cred
 * leaderboard. Adapted from the Phase B reference (MemoryCredLeaderboard.jsx):
 * the mock data + scenario toggle are gone; it fetches real data per selected
 * domain from GET /api/agent-lab/memory/leaderboard and maps the reference
 * palette onto the dashboard's --estate-* tokens so it reads as one system.
 *
 * Both rendered states from the reference are preserved:
 *   - NASCENT (launch day): every entry has seasonXp === 0, so a ranked table
 *     would be a wall of identical role-prior scores. We detect that and render
 *     a "warming up" state instead — an unranked provisional roster plus a short
 *     "here's how cred is earned" explainer.
 *   - RANKED: once XP exists, a compact board with provisional styling,
 *     promotion/demotion zones, movement arrows, and the caller's row highlighted.
 *
 * "League" framing is suppressed while the board is small (< 12) — it reads as
 * pretentious for a handful of contributors.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Trophy, ArrowRight } from 'lucide-react';

// ── Types (mirror the API's wire shape — note: no userId) ──────────────────────

interface Entry {
  rank: number;
  seasonXp: number;
  cred: number;
  provisional: boolean;
  zone: 'promotion' | 'demotion' | 'hold';
  movement: number | null;
  isYou: boolean;
  displayName: string;
}
interface View {
  domain: string;
  league: number;
  leagueSize: number;
  top: Entry[];
  around: Entry[];
  you: Entry | null;
}
interface LeaderboardResponse {
  domains: string[];
  cohortSize: number;
  view: View | null;
}

// ── Design tokens (shared with DashboardView) ──────────────────────────────────

const SERIF = "'Source Serif 4', Georgia, serif";
const SANS = "'Inter Tight', sans-serif";
const MONO = "'IBM Plex Mono', monospace";

const ACCENT = '#A78BFA'; // memory purple — ties this card to the Memory module
const TEAL = '#2DD4A0'; // promotion / climbing
const GOLD = '#FDB515'; // elite cred
const RUST = '#D9774B'; // demotion / dropping
const MUTED = 'var(--estate-text-muted)';

const LEAGUE_MIN = 12; // below this, show one unlabelled board (no "league" wording)
const TOP_N = 5; // compact: show the top few on the dashboard

// Map a cred score (0–100) to a colour. Provisional users read as neutral so an
// unearned role prior never masquerades as an earned score.
function credColor(cred: number, provisional: boolean): string {
  if (provisional) return MUTED;
  if (cred >= 85) return GOLD;
  return TEAL;
}

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  return parts.map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Meter({ cred, provisional, width = 96 }: { cred: number; provisional: boolean; width?: number | string }) {
  return (
    <div
      className="mcred-meter"
      style={{ width, height: 7 }}
      title={provisional ? 'Provisional — not enough signal yet' : `Cred ${cred}/100`}
      aria-label={provisional ? 'Provisional' : `Cred ${cred} of 100`}
    >
      {provisional ? (
        <span className="mcred-meter-prov" style={{ width: '34%' }} />
      ) : (
        <span className="mcred-meter-fill" style={{ width: `${cred}%`, background: credColor(cred, false) }} />
      )}
    </div>
  );
}

function Movement({ m }: { m: number | null }) {
  if (m == null) return <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>new</span>;
  if (m > 0) return <span style={{ fontFamily: MONO, fontSize: 11, color: TEAL }}>▲{m}</span>;
  if (m < 0) return <span style={{ fontFamily: MONO, fontSize: 11, color: RUST }}>▼{Math.abs(m)}</span>;
  return <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>—</span>;
}

function Avatar({ name, color, size = 26 }: { name: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO, fontSize: size <= 26 ? 9.5 : 11, fontWeight: 600,
        color: 'var(--estate-ink)', background: 'var(--estate-hover)',
        border: `1.5px solid ${color}`,
      }}
    >
      {initials(name)}
    </span>
  );
}

function YouTag() {
  return (
    <span
      style={{
        fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: TEAL, border: `1px solid color-mix(in srgb, ${TEAL} 55%, transparent)`,
        borderRadius: 4, padding: '1px 4px', marginLeft: 6,
      }}
    >
      you
    </span>
  );
}

// ── Rendered states ────────────────────────────────────────────────────────

function BoardRow({ e }: { e: Entry }) {
  const zoneAccent = e.zone === 'promotion' ? TEAL : e.zone === 'demotion' ? RUST : 'transparent';
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: '22px 1fr auto', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 8, position: 'relative',
        boxShadow: `inset 3px 0 0 ${zoneAccent}`,
        background: e.isYou ? `color-mix(in srgb, ${TEAL} 8%, transparent)` : 'transparent',
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 12, color: MUTED, textAlign: 'right' }}>
        {e.seasonXp > 0 ? e.rank : '–'}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <Avatar name={e.displayName} color={credColor(e.cred, e.provisional)} />
        <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <span style={{ fontFamily: SANS, fontSize: 13, color: 'var(--estate-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.displayName}
          </span>
          {e.isYou && <YouTag />}
        </span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Meter cred={e.cred} provisional={e.provisional} width={84} />
        <span style={{ fontFamily: MONO, fontSize: 12, minWidth: 62, color: e.provisional ? MUTED : credColor(e.cred, false) }}>
          {e.provisional ? 'provisional' : e.cred}
        </span>
        <span className="mcred-hide-sm" style={{ fontFamily: MONO, fontSize: 12, color: 'var(--estate-ink)', width: 44, textAlign: 'right' }}>
          {e.seasonXp}<span style={{ color: MUTED, fontSize: 10 }}>xp</span>
        </span>
        <span className="mcred-hide-sm" style={{ width: 34, textAlign: 'right' }}><Movement m={e.movement} /></span>
      </span>
    </div>
  );
}

function RankedState({ view }: { view: View }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {view.you && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '10px 12px', borderRadius: 9,
            background: `color-mix(in srgb, ${TEAL} 7%, var(--estate-hover))`,
            border: '1px solid var(--estate-border)',
          }}
        >
          <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--estate-text-secondary)' }}>
            Your standing
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: 'var(--estate-ink)' }}>
              #{view.you.rank} <span style={{ color: MUTED, fontWeight: 400, fontSize: 11 }}>of {view.leagueSize}</span>
            </span>
            <Movement m={view.you.movement} />
            <span style={{ fontFamily: MONO, fontSize: 14, color: credColor(view.you.cred, view.you.provisional) }}>
              {view.you.provisional ? '—' : view.you.cred}
            </span>
          </span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {view.top.slice(0, TOP_N).map((e) => (
          <BoardRow key={`${e.rank}-${e.displayName}`} e={e} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', paddingTop: 4 }}>
        <Legend color={TEAL} label="promotion" />
        <Legend color={RUST} label="demotion" />
        <Legend color={MUTED} label="provisional" dashed />
      </div>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 10.5, color: MUTED }}>
      <span
        style={{
          width: 9, height: 9, borderRadius: 2,
          background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 4px)` : color,
        }}
      />
      {label}
    </span>
  );
}

function NascentState({ view }: { view: View }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.55, color: 'var(--estate-text-secondary)', margin: 0, maxWidth: '60ch' }}>
        Cred is earned, not given. Contribute memory in{' '}
        <span style={{ fontFamily: MONO, color: 'var(--estate-ink)' }}>{view.domain}</span> that proves helpful on
        real runs and meters fill in. Everyone here is provisional until they have a track record.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {view.top.slice(0, 6).map((e) => (
          <div
            key={`${e.rank}-${e.displayName}`}
            style={{
              display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10,
              background: 'var(--estate-hover)',
              border: `1px solid ${e.isYou ? `color-mix(in srgb, ${TEAL} 55%, transparent)` : 'var(--estate-border)'}`,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar name={e.displayName} color={MUTED} size={30} />
              <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <span style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--estate-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.displayName}
                </span>
                {e.isYou && <YouTag />}
              </span>
            </span>
            <Meter cred={e.cred} provisional width="100%" />
            <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
              provisional
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, borderTop: '1px solid var(--estate-border)', paddingTop: 14 }}>
        <HowRow sym="+" text="helpful on a run → cred rises in that class" />
        <HowRow sym="−" text="harmful → cred falls harder than help raises it" />
        <HowRow sym="↻" text="idle cred fades over ~120 days" />
      </div>
    </div>
  );
}

function HowRow({ sym, text }: { sym: string; text: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: SANS, fontSize: 12.5, color: MUTED }}>
      <span
        style={{
          display: 'inline-flex', width: 20, height: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--estate-border)', borderRadius: 5, fontFamily: MONO, color: 'var(--estate-ink)', fontSize: 12,
        }}
      >
        {sym}
      </span>
      {text}
    </span>
  );
}

// ── Main card ────────────────────────────────────────────────────────────────

export function MemoryCredCard({ index = 4 }: { index?: number }) {
  const reduce = useReducedMotion();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (d: string | null, signal?: AbortSignal) => {
    const qs = d ? `?domain=${encodeURIComponent(d)}` : '';
    const res = await fetch(`/api/agent-lab/memory/leaderboard${qs}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as LeaderboardResponse;
  }, []);

  // Initial load — server picks the busiest domain as default.
  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    load(null, ac.signal)
      .then((r) => {
        setData(r);
        setDomain(r.view?.domain ?? null);
        setStatus('ready');
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setStatus('error');
      });
    return () => ac.abort();
  }, [load]);

  const selectDomain = useCallback(
    (d: string) => {
      if (d === domain) return;
      setDomain(d);
      const ac = new AbortController();
      load(d, ac.signal)
        .then((r) => {
          setData(r);
          setStatus('ready');
        })
        .catch((e) => {
          if (e?.name !== 'AbortError') setStatus('error');
        });
    },
    [domain, load],
  );

  const view = data?.view ?? null;
  const domains = data?.domains ?? [];
  // Launch-day / warming-up: no XP anywhere yet. Note [].every() === true, so a
  // board with no reputation rows at all (domains exist, but nothing attributed
  // yet) also takes this path — which is exactly the day-one state.
  const nascent = !!view && view.top.every((e) => e.seasonXp === 0);
  const showLeague = !!view && view.leagueSize >= LEAGUE_MIN;

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: reduce ? 0 : 0.05 * index, ease: 'easeOut' }}
      className="mcred rounded-xl border shadow-card"
      style={{ background: 'var(--estate-raised)', borderColor: 'var(--estate-border-gold)', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}
      aria-label="Memory cred leaderboard"
    >
      <style>{SCOPED_CSS}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <span
            style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `color-mix(in srgb, ${ACCENT} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${ACCENT} 30%, transparent)`,
            }}
          >
            <Trophy size={18} style={{ color: ACCENT }} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: 'var(--estate-ink)', margin: 0, lineHeight: 1.2 }}>
              Memory Cred
            </h2>
            <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--estate-text-muted)', margin: '2px 0 0' }}>
              Trust earned per agent class
              {view ? ` · ${view.leagueSize} contributor${view.leagueSize === 1 ? '' : 's'}` : ''}
              {showLeague ? ` · league ${view!.league + 1}` : ''}
            </p>
          </div>
        </div>

        {/* Domain tabs */}
        {domains.length > 0 && (
          <div role="tablist" aria-label="Agent class" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {domains.map((d) => {
              const on = d === domain;
              return (
                <button
                  key={d}
                  role="tab"
                  aria-selected={on}
                  className="mcred-tab"
                  onClick={() => selectDomain(d)}
                  style={{
                    fontFamily: MONO, fontSize: 11, cursor: 'pointer', borderRadius: 7, padding: '4px 10px',
                    border: `1px solid ${on ? `color-mix(in srgb, ${ACCENT} 45%, transparent)` : 'var(--estate-border)'}`,
                    background: on ? `color-mix(in srgb, ${ACCENT} 14%, transparent)` : 'transparent',
                    color: on ? 'var(--estate-ink)' : 'var(--estate-text-muted)',
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Body */}
      {status === 'loading' && <Note text="Loading leaderboard…" />}
      {status === 'error' && <Note text="Couldn’t load the leaderboard right now." dashed />}
      {status === 'ready' && !view && (
        <Note text="No agent classes in memory yet — the board appears once memory is synthesised." dashed />
      )}
      {status === 'ready' && view && (nascent ? <NascentState view={view} /> : <RankedState view={view} />)}
    </motion.section>
  );
}

function Note({ text, dashed }: { text: string; dashed?: boolean }) {
  return (
    <div
      style={{
        border: `1px ${dashed ? 'dashed' : 'solid'} var(--estate-border-gold)`, borderRadius: 8, padding: '20px 16px',
        textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--estate-text-muted)',
      }}
    >
      {text}
    </div>
  );
}

const SCOPED_CSS = `
.mcred .mcred-meter{position:relative;background:var(--estate-hover);border:1px solid var(--estate-border);border-radius:6px;overflow:hidden;display:inline-block;vertical-align:middle}
.mcred .mcred-meter-fill{position:absolute;left:0;top:0;bottom:0;border-radius:6px}
.mcred .mcred-meter-prov{position:absolute;left:0;top:0;bottom:0;border-radius:6px;opacity:.55;background:repeating-linear-gradient(90deg,var(--estate-text-muted) 0 3px,transparent 3px 7px)}
.mcred .mcred-tab:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
@media (max-width:560px){.mcred .mcred-hide-sm{display:none !important}}
@media (prefers-reduced-motion: reduce){.mcred *{transition:none !important}}
`;
