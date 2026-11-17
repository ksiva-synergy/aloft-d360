'use client';

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, Sparkles } from 'lucide-react';
import { Companion } from '@/components/companion/Companion';
import { type } from '@/lib/typography/tokens';
import {
  isStakeholderFacingLine,
  normalizeWelcomeCatalog,
  scrubStakeholderLine,
  type WelcomeArea,
  type WelcomeCatalog,
} from '@/lib/inspector/welcome-catalog';

function MoversPreview() {
  const bars = [14, 22, -10, 30, -18, 8, -6];
  return (
    <svg viewBox="0 0 120 44" className="iw-svg" aria-hidden>
      <line x1="0" y1="22" x2="120" y2="22" stroke="currentColor" strokeOpacity=".18" />
      {bars.map((v, i) => (
        <rect
          key={i}
          x={6 + i * 16}
          y={v > 0 ? 22 - v * 0.6 : 22}
          width="9"
          height={Math.abs(v) * 0.6}
          rx="2"
          fill={v > 0 ? 'var(--ok)' : 'var(--bad)'}
          opacity={i === 3 || i === 4 ? 1 : 0.45}
        />
      ))}
    </svg>
  );
}

function YoYPreview() {
  return (
    <svg viewBox="0 0 120 44" className="iw-svg" aria-hidden>
      <path d="M4 32 C20 30, 30 26, 44 27 S70 22, 84 20 S106 16, 116 15" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" strokeDasharray="3 3" />
      <path d="M4 34 C18 30, 30 22, 44 21 S68 14, 84 12 S104 8, 116 6" fill="none" stroke="var(--iw-accent)" strokeWidth="2.25" strokeLinecap="round" />
      <circle cx="116" cy="6" r="3" fill="var(--iw-accent)" />
    </svg>
  );
}

function BriefPreview() {
  const rows = [70, 92, 54];
  return (
    <svg viewBox="0 0 120 44" className="iw-svg" aria-hidden>
      {rows.map((w, i) => (
        <g key={i}>
          <circle cx="8" cy={9 + i * 13} r="3" fill={i === 0 ? 'var(--iw-accent)' : 'currentColor'} opacity={i === 0 ? 1 : 0.3} />
          <rect x="16" y={6.5 + i * 13} width={w} height="5" rx="2.5" fill="currentColor" opacity={i === 0 ? 0.45 : 0.18} />
        </g>
      ))}
    </svg>
  );
}

function ChartPreview() {
  return (
    <svg viewBox="0 0 120 44" className="iw-svg" aria-hidden>
      <defs>
        <linearGradient id="iw-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--iw-accent)" stopOpacity=".35" />
          <stop offset="1" stopColor="var(--iw-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M4 34 L22 28 L38 31 L56 18 L72 22 L90 10 L116 14 L116 44 L4 44 Z" fill="url(#iw-area)" />
      <path d="M4 34 L22 28 L38 31 L56 18 L72 22 L90 10 L116 14" fill="none" stroke="var(--iw-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="90" cy="10" r="3" fill="var(--surface-1)" stroke="var(--iw-accent)" strokeWidth="2" />
    </svg>
  );
}

// ── Domain illustrations ──────────────────────────────────────────────────────
// Each business area gets a scene that says what it is at a glance, paired with
// a small data motif so the card still reads as "ask about this data".
// Wider viewBox (200×44) than the generic previews so they fill the card strip.

/** Crewing: crew on board vs on leave, plus a rotation plan (Gantt). */
function CrewingPreview() {
  const crew = [
    { x: 14, on: true }, { x: 36, on: true }, { x: 58, on: true }, { x: 80, on: false }, { x: 102, on: false },
  ];
  const rows: Array<Array<[number, number, boolean]>> = [
    [[130, 30, true], [163, 33, false]],
    [[130, 12, false], [145, 40, true], [188, 8, false]],
    [[130, 22, true], [155, 14, false], [172, 24, true]],
  ];
  return (
    <svg viewBox="0 0 200 44" className="iw-svg" aria-hidden>
      {crew.map(({ x, on }) => (
        <g key={x} fill={on ? 'var(--iw-accent)' : 'currentColor'} opacity={on ? 1 : 0.3}>
          <circle cx={x} cy="13" r="4.5" />
          <path d={`M${x - 8} 33 Q${x - 8} 20.5 ${x} 20.5 Q${x + 8} 20.5 ${x + 8} 33 Z`} />
        </g>
      ))}
      {rows.map((segs, r) =>
        segs.map(([x, w, on]) => (
          <rect key={`${r}-${x}`} x={x} y={8 + r * 11} width={w - 2} height="6" rx="3"
            fill={on ? 'var(--iw-accent)' : 'currentColor'} opacity={on ? 0.85 : 0.2} />
        )),
      )}
      <line x1="160" y1="4" x2="160" y2="40" stroke="currentColor" strokeOpacity=".45" strokeDasharray="2 2" />
    </svg>
  );
}

/** Marine: a vessel under way, its route to the next port. */
function MarinePreview() {
  return (
    <svg viewBox="0 0 200 44" className="iw-svg" aria-hidden>
      <path d="M78 22 C110 2, 150 2, 176 15" fill="none" stroke="currentColor" strokeOpacity=".4" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="180" cy="17" r="6" fill="var(--iw-accent)" opacity=".18" />
      <circle cx="180" cy="17" r="3" fill="var(--iw-accent)" />
      <g className="iw-ship">
        <rect x="26" y="20" width="6" height="5" rx="1" fill="currentColor" opacity=".35" />
        <rect x="33" y="20" width="6" height="5" rx="1" fill="currentColor" opacity=".5" />
        <rect x="40" y="20" width="6" height="5" rx="1" fill="currentColor" opacity=".35" />
        <rect x="29.5" y="15" width="6" height="5" rx="1" fill="currentColor" opacity=".25" />
        <rect x="52" y="15" width="12" height="10" rx="1.5" fill="var(--iw-accent)" opacity=".7" />
        <rect x="56" y="10" width="4" height="5" rx="1" fill="var(--iw-accent)" />
        <path d="M18 25 H74 L66 34 H26 Z" fill="var(--iw-accent)" />
      </g>
      <path d="M0 39 q6 -3 12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0"
        fill="none" stroke="var(--iw-accent)" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Technical: machinery (gear) and the maintenance job list — one overdue. */
function TechnicalPreview() {
  const jobs = [
    { w: 92, state: 'done' }, { w: 70, state: 'overdue' }, { w: 112, state: 'open' },
  ] as const;
  return (
    <svg viewBox="0 0 200 44" className="iw-svg" aria-hidden>
      <g className="iw-gear">
        <circle cx="26" cy="22" r="14" fill="none" stroke="var(--iw-accent)" strokeWidth="5" strokeDasharray="5.5 5.5" />
        <circle cx="26" cy="22" r="11" fill="var(--iw-accent)" />
        <circle cx="26" cy="22" r="4" fill="var(--surface-1)" />
      </g>
      {jobs.map(({ w, state }, i) => {
        const y = 9 + i * 13;
        const color = state === 'done' ? 'var(--ok)' : state === 'overdue' ? 'var(--bad)' : 'currentColor';
        return (
          <g key={i}>
            <circle cx="60" cy={y} r="4" fill={color} opacity={state === 'open' ? 0.3 : 1} />
            {state === 'done' && (
              <path d={`M58 ${y} l1.5 1.5 l3 -3`} fill="none" stroke="var(--surface-1)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            )}
            <rect x="70" y={y - 2.5} width={w} height="5" rx="2.5" fill={state === 'overdue' ? 'var(--bad)' : 'currentColor'}
              opacity={state === 'overdue' ? 0.45 : 0.2} />
          </g>
        );
      })}
    </svg>
  );
}

/** QHSE: safety shield, incidents trending down toward a target line. */
function QhsePreview() {
  const bars = [26, 20, 22, 15, 12, 9, 6];
  return (
    <svg viewBox="0 0 200 44" className="iw-svg" aria-hidden>
      <path d="M24 4 L38 9 V21 C38 30 31 36 24 40 C17 36 10 30 10 21 V9 Z" fill="var(--iw-accent)" fillOpacity=".16"
        stroke="var(--iw-accent)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M17.5 21.5 L22 26 L30.5 17" fill="none" stroke="var(--iw-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="56" y1="40" x2="196" y2="40" stroke="currentColor" strokeOpacity=".18" />
      <line x1="56" y1="30" x2="196" y2="30" stroke="var(--iw-accent)" strokeOpacity=".6" strokeDasharray="3 3" />
      {bars.map((h, i) => (
        <rect key={i} x={60 + i * 19.5} y={40 - h} width="10" height={h} rx="2"
          fill={i === bars.length - 1 ? 'var(--iw-accent)' : 'currentColor'} opacity={i === bars.length - 1 ? 1 : 0.28} />
      ))}
    </svg>
  );
}

/** Finance: coin stack and a revenue → costs → EBITDA waterfall. */
function FinancePreview() {
  // [top, bottom, kind] in SVG y; baseline at 40.
  const steps: Array<[number, number, 'total' | 'down' | 'up' | 'result']> = [
    [6, 40, 'total'], [6, 15, 'down'], [15, 22, 'down'], [19, 22, 'up'], [19, 25, 'down'], [25, 40, 'result'],
  ];
  const fill = { total: 'currentColor', down: 'var(--bad)', up: 'var(--ok)', result: 'var(--iw-accent)' };
  const op = { total: 0.3, down: 0.7, up: 0.8, result: 1 };
  return (
    <svg viewBox="0 0 200 44" className="iw-svg" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={10 + (i % 2) * 1.5} y={34 - i * 7} width="22" height="6" rx="3" fill="var(--iw-accent)" opacity={0.5 + i * 0.15} />
          <rect x={14 + (i % 2) * 1.5} y={36 - i * 7} width="14" height="1.2" rx=".6" fill="var(--surface-1)" opacity=".7" />
        </g>
      ))}
      <line x1="52" y1="40" x2="196" y2="40" stroke="currentColor" strokeOpacity=".18" />
      {steps.map(([top, bottom, kind], i) => {
        const x = 58 + i * 23;
        const next = steps[i + 1];
        const level = kind === 'up' ? top : kind === 'down' ? bottom : top;
        return (
          <g key={i}>
            <rect x={x} y={top} width="14" height={bottom - top} rx="2" fill={fill[kind]} opacity={op[kind]} />
            {next && (
              <line x1={x + 14} y1={level} x2={x + 23} y2={level} stroke="currentColor" strokeOpacity=".35" strokeDasharray="2 1.5" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** HR: an org chart and the headcount mix. */
function HrPreview() {
  const kids = [22, 50, 78];
  const r = 12;
  const c = 2 * Math.PI * r;
  const segs: Array<[number, number]> = [[0.5, 1], [0.3, 0.45], [0.2, 0.22]];
  let offset = 0;
  return (
    <svg viewBox="0 0 200 44" className="iw-svg" aria-hidden>
      <path d="M50 14 V22 M22 22 H78 M22 22 V29 M50 22 V29 M78 22 V29" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.4" />
      <circle cx="50" cy="8" r="5.5" fill="var(--iw-accent)" />
      {kids.map((x) => (
        <circle key={x} cx={x} cy="34" r="5" fill="currentColor" opacity=".3" />
      ))}
      <g transform="rotate(-90 128 22)">
        {segs.map(([share, o], i) => {
          const len = share * c;
          const el = (
            <circle key={i} cx="128" cy="22" r={r} fill="none" stroke={i === 0 ? 'var(--iw-accent)' : 'currentColor'}
              strokeOpacity={i === 0 ? 1 : o} strokeWidth="6" strokeDasharray={`${len - 1.5} ${c - len + 1.5}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </g>
      {[46, 30, 18].map((w, i) => (
        <g key={i}>
          <circle cx="154" cy={11 + i * 11} r="2.5" fill={i === 0 ? 'var(--iw-accent)' : 'currentColor'} opacity={i === 0 ? 1 : segs[i][1]} />
          <rect x="160" y={9 + i * 11} width={w * 0.8} height="4" rx="2" fill="currentColor" opacity=".2" />
        </g>
      ))}
    </svg>
  );
}

type DomainVisual = { Preview: () => React.JSX.Element; accent: string };

const DOMAIN_VISUALS: Record<string, DomainVisual> = {
  crewing: { Preview: CrewingPreview, accent: 'var(--brand-a)' },
  marine: { Preview: MarinePreview, accent: 'var(--brand-b)' },
  technical: { Preview: TechnicalPreview, accent: 'var(--warn)' },
  qhse: { Preview: QhsePreview, accent: 'var(--ok)' },
  finance: { Preview: FinancePreview, accent: 'var(--brand-c)' },
  hr: { Preview: HrPreview, accent: 'var(--ink-2)' },
};

/** Loose label matches for areas whose key isn't one of the canonical six. */
const DOMAIN_ALIASES: Array<[RegExp, string]> = [
  [/crew|seafarer/i, 'crewing'],
  [/marine|vessel|voyage|fleet/i, 'marine'],
  [/technical|maintenance|pms|defect/i, 'technical'],
  [/qhse|safety|incident|hse/i, 'qhse'],
  [/financ|account|ebitda/i, 'finance'],
  [/\bhr\b|people|human|employee/i, 'hr'],
];

const AREA_ACCENTS = ['var(--brand-a)', 'var(--brand-b)', 'var(--ok)', 'var(--warn)', 'var(--brand-c)', 'var(--ink-2)'];

const PREVIEWS = [MoversPreview, YoYPreview, BriefPreview, ChartPreview];

function visualFor(a: WelcomeArea, i: number): DomainVisual {
  const direct = DOMAIN_VISUALS[a.key.toLowerCase()];
  if (direct) return direct;
  const alias = DOMAIN_ALIASES.find(([re]) => re.test(a.key) || re.test(a.label));
  if (alias) return DOMAIN_VISUALS[alias[1]];
  return { Preview: PREVIEWS[i % PREVIEWS.length], accent: AREA_ACCENTS[i % AREA_ACCENTS.length] };
}

function greetingFor(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const fmt = new Intl.NumberFormat();

// ── Catalog cache ─────────────────────────────────────────────────────────────
// The welcome catalog changes rarely, so the cards render from the last copy at once
// (memory for in-app remounts, localStorage across reloads) and /api/inspector/welcome
// revalidates in the background. Entries carry the owning user id and are dropped when a
// different user is signed in.

const CATALOG_STORAGE_KEY = 'aloft.inspector.welcome.v1';
const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

interface CachedCatalog { owner: string; at: number; catalog: WelcomeCatalog }

let memoryCatalog: CachedCatalog | null = null;
let inflightCatalog: Promise<WelcomeCatalog> | null = null;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function readStoredCatalog(): CachedCatalog | null {
  try {
    const raw = window.localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCatalog>;
    if (!parsed.owner || !parsed.catalog || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > CATALOG_MAX_AGE_MS) return null;
    return { owner: parsed.owner, at: parsed.at, catalog: normalizeWelcomeCatalog(parsed.catalog) };
  } catch {
    return null;
  }
}

function storeCatalog(entry: CachedCatalog): void {
  memoryCatalog = entry;
  try {
    window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* storage full or blocked — memory cache still works */
  }
}

function fetchCatalog(): Promise<WelcomeCatalog> {
  if (!inflightCatalog) {
    inflightCatalog = fetch('/api/inspector/welcome')
      .then((r) => (r.ok ? r.json() as Promise<Partial<WelcomeCatalog>> : Promise.reject(new Error(String(r.status)))))
      .then(normalizeWelcomeCatalog)
      .finally(() => { inflightCatalog = null; });
  }
  return inflightCatalog;
}

/** Start loading the welcome catalog early (e.g. on hover of "New chat"). */
export function prefetchWelcomeCatalog(): void {
  if (typeof window === 'undefined' || memoryCatalog) return;
  void fetchCatalog().catch(() => {});
}

export interface InspectorWelcomeProps {
  modelId: string | null;
  onPrompt: (prompt: string) => void;
  onSelectDomain?: (domainKey: string | null) => void;
}

/** Empty chat: business areas (Crewing, Marine, …) as starter cards; drill in for questions. */
export function InspectorWelcome({ modelId: _modelId, onPrompt, onSelectDomain }: InspectorWelcomeProps) {
  const { data: session, status: sessionStatus } = useSession();
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);
  // Memory cache is safe in the initializer: it is only ever filled on the client, after
  // hydration, so the server render and the hydrating render both start from null.
  const [cached, setCached] = useState<CachedCatalog | null>(() => memoryCatalog);
  const [fresh, setFresh] = useState<WelcomeCatalog | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedSubtopic, setSelectedSubtopic] = useState<string | null>(null);
  const [showAllOffers, setShowAllOffers] = useState(false);
  const [showAllDomains, setShowAllDomains] = useState(false);

  const selectDomain = (key: string | null) => {
    setSelectedKey(key);
    setSelectedSubtopic(null);
    setShowAllOffers(false);
    onSelectDomain?.(key);
  };

  // Before first paint: pick up the copy saved by an earlier page load.
  useIsomorphicLayoutEffect(() => {
    if (!cached) {
      const stored = readStoredCatalog();
      if (stored) {
        memoryCatalog = stored;
        setCached(stored);
      }
    }
    // Mount-only: later updates come from the revalidation below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always revalidate in the background.
  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((d) => { if (!cancelled) { setFresh(d); setFetchFailed(false); } })
      .catch(() => { if (!cancelled) setFetchFailed(true); });
    return () => { cancelled = true; };
  }, []);

  // Persist the fresh copy under the signed-in user's id.
  useEffect(() => {
    if (fresh && userId) storeCatalog({ owner: userId, at: Date.now(), catalog: fresh });
  }, [fresh, userId]);

  // A cached copy is only shown while it could belong to the current user.
  const cachedUsable =
    cached && (sessionStatus === 'loading' || (userId != null && cached.owner === userId))
      ? cached.catalog
      : null;
  const catalog = fresh ?? cachedUsable;
  const catalogState: 'loading' | 'ok' | 'error' = catalog ? 'ok' : fetchFailed ? 'error' : 'loading';

  const hasData = catalogState === 'ok' && catalog && catalog.totalTables > 0;
  const selectedArea = selectedKey && catalog ? catalog.areas.find((a) => a.key === selectedKey) : null;
  const visibleDomains =
    catalog && (showAllDomains ? catalog.areas : catalog.areas.slice(0, 6));
  const hiddenDomainCount =
    catalog && !showAllDomains && catalog.totalAreas > catalog.areas.length
      ? catalog.totalAreas - catalog.areas.length
      : 0;

  return (
    <div className="iw-root">
      <div className="iw-glow" aria-hidden />
      <div className="iw-stack">
        {/* ── Hero ── */}
        <div className="iw-hero">
          <Companion size={64} />
        </div>
        <div className="iw-head">
          {/* Greeting depends on the viewer's clock; server render may differ. */}
          <h1 className="iw-title" style={{ ...type['title-page'], margin: 0 }} suppressHydrationWarning>
            {greeting}
            {firstName ? (
              <>
                , <span className="iw-name">{firstName}</span>
              </>
            ) : null}
          </h1>
          <p style={{ ...type.body, color: 'var(--ink-3)', margin: 0 }}>
            {hasData ? 'What should we dig into today?' : 'Ask for a number, a reason, or a chart.'}
          </p>
        </div>

        {catalogState !== 'error' && (
          <section className="iw-section" aria-labelledby="iw-data-h">
            <div className="iw-section-head">
              {selectedArea ? (
                <h2 id="iw-data-h" className="iw-eyebrow" style={type.eyebrow}>{selectedArea.label}</h2>
              ) : (
                <span id="iw-data-h" className="iw-section-spacer" aria-hidden />
              )}
              {selectedArea ? (
                <button
                  type="button"
                  className="iw-back"
                  style={type['ui-regular']}
                  onClick={() => selectDomain(null)}
                >
                  <ArrowLeft size={14} aria-hidden />
                  Back
                </button>
              ) : hasData && hiddenDomainCount > 0 ? (
                <button
                  type="button"
                  className="iw-link"
                  style={type['ui-regular']}
                  onClick={() => setShowAllDomains(true)}
                >
                  Show {fmt.format(hiddenDomainCount)} more
                </button>
              ) : null}
            </div>

            {catalogState === 'loading' ? (
              <div className="iw-grid" aria-busy>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="iw-card iw-card-skel ld-skel" style={{ '--iw-accent': AREA_ACCENTS[i] } as React.CSSProperties} />
                ))}
              </div>
            ) : selectedArea ? (
              <div className="iw-drill">
                {(() => {
                  const lead = scrubStakeholderLine(selectedArea.tagline);
                  const showLead = lead && isStakeholderFacingLine(lead);
                  const allOffers = selectedArea.offers ?? [];
                  const briefOffer = allOffers.find((o) => /^brief me on\b/i.test(o.label)) ?? null;
                  const questionOffers = allOffers.filter((o) => o !== briefOffer);
                  const subtopics = selectedArea.subtopics ?? [];
                  const filteredOffers = selectedSubtopic
                    ? questionOffers.filter((o) => o.topic === selectedSubtopic)
                    : questionOffers;
                  const initialCap = 6;
                  const visibleOffers = showAllOffers ? filteredOffers : filteredOffers.slice(0, initialCap);
                  const moreCount = filteredOffers.length - visibleOffers.length;

                  return (
                    <>
                      <div className="iw-drill-top">
                        {showLead ? (
                          <p className="iw-drill-lead" style={{ ...type.body, margin: 0 }}>{lead}</p>
                        ) : <span />}
                        {briefOffer && (
                          <button
                            type="button"
                            className="iw-brief-btn"
                            onClick={() => onPrompt(briefOffer.prompt)}
                            style={type.label}
                          >
                            <Sparkles size={13} aria-hidden />
                            <span>{briefOffer.label}</span>
                          </button>
                        )}
                      </div>

                      {subtopics.length > 1 && (
                        <div className="iw-subtopics" role="tablist" aria-label={`${selectedArea.label} sub-areas`}>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={selectedSubtopic === null}
                            className={`iw-pill${selectedSubtopic === null ? ' is-active' : ''}`}
                            onClick={() => { setSelectedSubtopic(null); setShowAllOffers(false); }}
                            style={type.caption}
                          >
                            All
                            <span className="iw-pill-count">{questionOffers.length}</span>
                          </button>
                          {subtopics.map((st) => {
                            const active = selectedSubtopic === st.label;
                            return (
                              <button
                                key={st.key}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                className={`iw-pill${active ? ' is-active' : ''}`}
                                onClick={() => { setSelectedSubtopic(active ? null : st.label); setShowAllOffers(false); }}
                                style={type.caption}
                              >
                                {st.label}
                                <span className="iw-pill-count">{st.count}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="iw-offers-grid">
                        {visibleOffers.map((o) => (
                          <button
                            key={o.label}
                            type="button"
                            className="iw-offer"
                            onClick={() => onPrompt(o.prompt)}
                          >
                            <span className="iw-offer-body">
                              <span className="iw-offer-q">{o.label}</span>
                              {o.topic && selectedSubtopic === null && (
                                <span className="iw-offer-topic" style={type.caption}>{o.topic}</span>
                              )}
                            </span>
                            <span className="iw-offer-go" aria-hidden>
                              <ArrowRight size={13} />
                            </span>
                          </button>
                        ))}
                      </div>

                      {(moreCount > 0 || (showAllOffers && filteredOffers.length > initialCap)) && (
                        <div className="iw-drill-foot">
                          <button
                            type="button"
                            className="iw-more"
                            style={type.label}
                            aria-expanded={showAllOffers}
                            onClick={() => setShowAllOffers((v) => !v)}
                          >
                            {showAllOffers
                              ? 'Show fewer'
                              : `Show ${fmt.format(moreCount)} more ${moreCount === 1 ? 'question' : 'questions'}`}
                            <ChevronDown size={14} aria-hidden />
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : hasData && visibleDomains ? (
              <div className="iw-grid iw-grid-areas">
                {visibleDomains.map((a, i) => {
                  const { Preview, accent } = visualFor(a, i);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className="iw-card"
                      onClick={() => selectDomain(a.key)}
                      style={{ '--iw-accent': accent, animationDelay: `${60 + i * 40}ms` } as React.CSSProperties}
                    >
                      <span className="iw-preview"><Preview /></span>
                      <span className="iw-card-body">
                        <span className="iw-card-title" style={{ ...type['ui-lg'], fontWeight: 600 }}>
                          {a.label}
                          <ArrowUpRight size={14} className="iw-card-arrow" aria-hidden />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="iw-empty" style={{ ...type['ui-regular'], margin: 0 }}>
                No data has been shared with you yet. Ask anyway — I’ll tell you what I can reach and who can grant access.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
