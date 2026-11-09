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
 *     labeled seasonal XP and trust, a personal summary, and the caller's row highlighted.
 *
 * League labels and promotion/demotion zones are suppressed while the board is small (< 12) — it reads as
 * pretentious for a handful of contributors.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { type, inkOf } from '@/lib/typography/tokens';
import styles from './MemoryCredCard.module.css';

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

const SANS = "'Inter Variable', sans-serif";
const MONO = "'Inter Variable', sans-serif"; // numbers get tabular figures from the .mcred rule

const ACCENT = 'var(--brand-a)';
const TEAL = 'var(--ok)'; // promotion / climbing
const GOLD = 'var(--brand-a)'; // elite cred
const RUST = 'var(--warn)'; // demotion / dropping
const MUTED = 'var(--ink-3)';

const LEAGUE_MIN = 12; // below this, show one unlabelled board (no "league" wording)
const TOP_N = 5; // compact: show the top few on the dashboard

// Map a cred score (0–100) to a colour. Provisional users read as neutral so an
// unearned role prior never masquerades as an earned score.
function credColor(cred: number, provisional: boolean): string {
  if (provisional) return MUTED;
  return GOLD;
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
  if (m == null) return <span style={{ fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)', color: MUTED }}>new</span>;
  if (m > 0) return <span style={{ fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)', color: TEAL }}>▲{m}</span>;
  if (m < 0) return <span style={{ fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)', color: RUST }}>▼{Math.abs(m)}</span>;
  return <span style={{ fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)', color: MUTED }}>—</span>;
}

function Avatar({ name, color, size = 26 }: { name: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO, fontSize: size <= 26 ? 9.5 : 11, fontWeight: 600,
        color: 'var(--ink-2)', background: 'var(--surface-2)',
        border: `1px solid ${color === MUTED ? 'var(--line-1)' : `color-mix(in srgb, ${color} 45%, transparent)`}`,
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
        ...type.label,
        color: inkOf(TEAL), border: `1px solid color-mix(in srgb, ${TEAL} 55%, transparent)`,
        borderRadius: 6, padding: '1px 4px', marginLeft: 6,
      }}
    >
      you
    </span>
  );
}

// ── Rendered states ────────────────────────────────────────────────────────

function BoardRow({ e, showLeague }: { e: Entry; showLeague: boolean }) {
  return <tr className={e.isYou ? styles.yourRow : undefined}>
    <td className={styles.rank}>{e.rank}</td>
    <td><div className={styles.person}><Avatar name={e.displayName} color={MUTED} size={30} /><div>
      <span className={styles.name}>{e.displayName}{e.isYou && <YouTag />}</span>
      {showLeague && e.zone !== 'hold' && <span className={styles.zone}>{e.zone === 'promotion' ? 'Promotion zone' : 'Demotion zone'}</span>}
    </div></div></td>
    <td className={styles.xp}>{e.seasonXp.toLocaleString()}</td>
    <td><div className={styles.trust}>{e.provisional ? <span className={styles.provisional}>Provisional</span> : <><Meter cred={e.cred} provisional={false} width="100%" /><strong>{e.cred}</strong></>}</div></td>
  </tr>;
}

function RankedState({ view }: { view: View }) {
  const showLeague = view.leagueSize >= LEAGUE_MIN;
  return <div className={styles.ranked}>
    {view.you && <aside className={styles.personal} aria-label="Your contribution">
      <span className={styles.eyebrow}>YOUR CONTRIBUTION</span>
      <div className={styles.standing}><strong>#{view.you.rank}</strong><span>of {view.leagueSize} contributors</span></div>
      <dl><div><dt>Season XP</dt><dd>{view.you.seasonXp.toLocaleString()}</dd></div>
        <div><dt>Trust score</dt><dd>{view.you.provisional ? 'Provisional' : <>{view.you.cred}<small> / 100</small></>}</dd></div>
      </dl>
      <p className={styles.personalNote}>{view.you.provisional ? 'Your trust score is forming as more contributions are evaluated.' : 'Trust reflects how your memory contributions perform when agents use them.'}</p>
      {view.you.movement !== null && <div className={styles.movement}>Rank change <Movement m={view.you.movement} /></div>}
    </aside>}
    <div className={styles.board}>
      <table className={styles.table}>
        <caption>Top {Math.min(TOP_N, view.top.length)} contributors <span>Ordered by seasonal XP</span></caption>
        <thead><tr><th scope="col">Rank</th><th scope="col">Contributor</th><th scope="col">Season XP</th><th scope="col">Trust / 100</th></tr></thead>
        <tbody>{view.top.slice(0, TOP_N).map(e => <BoardRow key={`${e.rank}-${e.displayName}`} e={e} showLeague={showLeague} />)}</tbody>
      </table>
      <details className={styles.explainer}><summary>What do these scores mean?</summary><p><strong>Season XP</strong> determines rank for the current season. <strong>Trust</strong> is a longer-term reliability score, so a lower-ranked contributor can have a higher trust score. <strong>Provisional</strong> means there isn’t enough evidence to show a settled score.</p></details>
    </div>
  </div>;
}

function NascentState({ view }: { view: View }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontFamily: SANS, fontSize: 'var(--type-ui-regular-size)', lineHeight: 1.55, color: 'var(--ink-2)', margin: 0, maxWidth: '60ch' }}>
        Cred is earned, not given. Contribute memory in{' '}
        <span style={{ fontFamily: MONO, color: 'var(--ink-1)' }}>{view.domain}</span> that proves helpful on
        real runs and meters fill in. Everyone here is provisional until they have a track record.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {view.top.slice(0, 6).map((e) => (
          <div
            key={`${e.rank}-${e.displayName}`}
            style={{
              display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10,
              background: 'var(--surface-2)',
              border: `1px solid ${e.isYou ? `color-mix(in srgb, ${TEAL} 55%, transparent)` : 'var(--line-1)'}`,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar name={e.displayName} color={MUTED} size={30} />
              <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <span style={{ fontFamily: SANS, fontSize: 'var(--type-ui-regular-size)', color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.displayName}
                </span>
                {e.isYou && <YouTag />}
              </span>
            </span>
            <Meter cred={e.cred} provisional width="100%" />
            <span style={{ ...type.label, color: MUTED }}>
              provisional
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, borderTop: '1px solid var(--line-1)', paddingTop: 14 }}>
        <HowRow sym="+" text="helpful on a run → cred rises in that class" />
        <HowRow sym="−" text="harmful → cred falls harder than help raises it" />
        <HowRow sym="↻" text="idle cred fades over ~120 days" />
      </div>
    </div>
  );
}

function HowRow({ sym, text }: { sym: string; text: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: SANS, fontSize: 'var(--type-ui-regular-size)', color: MUTED }}>
      <span
        style={{
          display: 'inline-flex', width: 20, height: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--line-1)', borderRadius: 5, fontFamily: MONO, color: 'var(--ink-1)', fontSize: 'var(--type-ui-regular-size)',
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

  // Abort the previous class request so its results cannot replace the selected class.
  useEffect(() => {
    const ac = new AbortController();
    setStatus('loading');
    load(domain, ac.signal).then(r => {
      if (!ac.signal.aborted) { setData(r); setStatus('ready'); }
    }).catch(e => {
      if (e?.name !== 'AbortError' && !ac.signal.aborted) setStatus('error');
    });
    return () => ac.abort();
  }, [load, domain]);

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
      className={`mcred ${styles.card}`}
      aria-label="Memory cred leaderboard"
    >
      <style>{SCOPED_CSS}</style>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className="shrink-0 text-title-card font-semibold text-[var(--ink-1)]">Memory contributions</h2>
          <span className={styles.subtitle}>
            People helping agents remember better
            {view ? ` · ${view.leagueSize} contributor${view.leagueSize === 1 ? '' : 's'}` : ''}
            {showLeague ? ` · league ${view!.league + 1}` : ''}
          </span>
        </div>

        {/* Domain tabs */}
        {domains.length > 0 && (
          <div role="group" aria-label="Agent class" className="inline-flex flex-wrap gap-0.5 rounded-ctl bg-[var(--surface-2)] p-0.5">
            {domains.map((d) => {
              const on = d === (domain ?? view?.domain);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className="mcred-tab"
                  onClick={() => setDomain(d)}
                  style={{
                    fontSize: 'var(--type-ui-regular-size)', cursor: 'pointer', borderRadius: 6, padding: '3px 10px', border: 0,
                    background: on ? 'var(--surface-1)' : 'transparent',
                    boxShadow: on ? '0 1px 2px rgba(0,0,0,0.10)' : 'none',
                    color: on ? 'var(--ink-1)' : 'var(--ink-3)', fontWeight: on ? 600 : 400, textTransform: 'capitalize',
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
      <div className={styles.body} aria-busy={status === 'loading'}>
      {status === 'loading' && <Note text="Loading leaderboard…" />}
      {status === 'error' && <Note text="Couldn’t load the leaderboard right now." dashed />}
      {status === 'ready' && !view && (
        <Note text="No agent classes in memory yet — the board appears once memory is synthesised." dashed />
      )}
      {status === 'ready' && view && (nascent ? <NascentState view={view} /> : <RankedState view={view} />)}
      </div>
    </motion.section>
  );
}

function Note({ text, dashed }: { text: string; dashed?: boolean }) {
  return (
    <div
      style={{
        border: `1px ${dashed ? 'dashed' : 'solid'} var(--line-1)`, borderRadius: 8, padding: '20px 16px',
        textAlign: 'center', fontFamily: MONO, fontSize: 'var(--type-ui-regular-size)', color: 'var(--ink-3)',
      }}
    >
      {text}
    </div>
  );
}

const SCOPED_CSS = `
.mcred{font-variant-numeric:tabular-nums}
.mcred .mcred-meter{position:relative;background:var(--surface-2);border:1px solid var(--line-1);border-radius:6px;overflow:hidden;display:inline-block;vertical-align:middle}
.mcred .mcred-meter-fill{position:absolute;left:0;top:0;bottom:0;border-radius:6px}
.mcred .mcred-meter-prov{position:absolute;left:0;top:0;bottom:0;border-radius:6px;opacity:.55;background:repeating-linear-gradient(90deg,var(--estate-text-muted) 0 3px,transparent 3px 7px)}
.mcred .mcred-tab:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
@media (max-width:560px){.mcred .mcred-hide-sm{display:none !important}}
@media (prefers-reduced-motion: reduce){.mcred *{transition:none !important}}
`;
