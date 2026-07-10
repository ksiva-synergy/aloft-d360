'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { GOLD, RULE_TYPE_COLORS, MONO, SERIF, BODY, ruleTypeColor } from '@/lib/foer/foer-tokens';
import type { KeeperSummaryResponse } from '@/app/api/agent-lab/memory/keeper-summary/route';

// ── Constants ────────────────────────────────────────────────────────────────

const RULE_TYPE_ORDER: Record<string, number> = {
  HARD_RULE:    0,
  FAILURE_MODE: 1,
  SCHEMA_MAP:   2,
  SOURCE_PREF:  3,
  HEURISTIC:    4,
};

const WINDOWS = [
  { label: '7d',  days: 7  },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ruleTypeLabel(rt: string): string {
  return rt.replace(/_/g, ' ');
}

/** Summarise a long rule text to a single short line for story view */
function summarise(text: string, maxLen = 90): string {
  const first = text.split(/[.\n]/)[0].trim();
  if (first.length <= maxLen) return first;
  return first.slice(0, maxLen - 1) + '…';
}

// ── Trace Graph SVG ──────────────────────────────────────────────────────────
// Draws a compact left-panel SVG: colored orbs per rule type arranged as a
// branching node graph. Static — no animation — just the "kept" shape.

interface TraceGraphProps {
  bullets: KeeperSummaryResponse['bullets'];
  sessionsScanned: number;
  memoriesAnalyzed: number;
  memoriesKept: number;
  phantomsBlocked: number;
}

function TraceGraph({ bullets, sessionsScanned, memoriesAnalyzed, memoriesKept, phantomsBlocked }: TraceGraphProps) {
  const W = 460;
  const H = 300;

  // Group bullets by type for the shelf arrangement
  const byType = useMemo(() => {
    const groups: Record<string, typeof bullets> = {};
    for (const b of bullets) {
      (groups[b.ruleType] ??= []).push(b);
    }
    return groups;
  }, [bullets]);

  // Layout: intake funnel on left → keeper node center → shelf orbs right
  const intakeX = 80;
  const intakeY = H / 2;
  const keeperX = 230;
  const keeperY = H / 2;
  const shelfX  = 380;

  // Shelf slots: up to 12 orbs, arranged in a column
  const shelfOrbs = useMemo(() => {
    const orbs: { x: number; y: number; color: string; type: string; label: string; conf: number }[] = [];
    const sortedBullets = [...bullets].sort((a, b) => {
      const oa = RULE_TYPE_ORDER[a.ruleType] ?? 99;
      const ob = RULE_TYPE_ORDER[b.ruleType] ?? 99;
      return oa !== ob ? oa - ob : b.confidence - a.confidence;
    });
    const maxOrbs = Math.min(sortedBullets.length, 12);
    const spacing = Math.min(28, (H - 40) / Math.max(maxOrbs, 1));
    const startY = (H - spacing * (maxOrbs - 1)) / 2;
    for (let i = 0; i < maxOrbs; i++) {
      const b = sortedBullets[i];
      orbs.push({
        x: shelfX,
        y: startY + i * spacing,
        color: ruleTypeColor(b.ruleType),
        type: b.ruleType,
        label: summarise(b.ruleText, 30),
        conf: b.confidence,
      });
    }
    return orbs;
  }, [bullets]);

  // Intake "session" nodes: small grey circles representing sessions scanned
  const intakeOrbs = useMemo(() => {
    const n = Math.min(sessionsScanned, 8);
    const orbs: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const ang = ((i / n) * Math.PI * 1.6) - Math.PI * 0.8;
      orbs.push({
        x: intakeX + Math.cos(ang) * 38,
        y: intakeY + Math.sin(ang) * 52,
      });
    }
    return orbs;
  }, [sessionsScanned]);

  const discarded = Math.max(0, memoriesAnalyzed - memoriesKept - phantomsBlocked);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: '100%',
        display: 'block',
        borderRadius: 6,
        border: '1px solid var(--foer-border-dim)',
        background: 'var(--foer-surface)',
      }}
      aria-label="Keeper choice trace graph"
      role="img"
    >
      <defs>
        <radialGradient id="keeperGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0"   stopColor={GOLD} stopOpacity={0.35} />
          <stop offset="1"   stopColor={GOLD} stopOpacity={0}    />
        </radialGradient>
        <radialGradient id="intakeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0"   stopColor="#5FA9AE" stopOpacity={0.20} />
          <stop offset="1"   stopColor="#5FA9AE" stopOpacity={0}    />
        </radialGradient>
      </defs>

      {/* Zone labels */}
      <text x={intakeX} y={18} textAnchor="middle" fontFamily={MONO} fontSize={8} fill="var(--foer-text-mut)" letterSpacing="1.2">
        SESSIONS
      </text>
      <text x={keeperX} y={18} textAnchor="middle" fontFamily={MONO} fontSize={8} fill="var(--foer-text-mut)" letterSpacing="1.2">
        THE KEEPER
      </text>
      <text x={shelfX} y={18} textAnchor="middle" fontFamily={MONO} fontSize={8} fill="var(--foer-text-mut)" letterSpacing="1.2">
        KEPT
      </text>

      {/* Intake → Keeper lines */}
      {intakeOrbs.map((o, i) => (
        <line
          key={i}
          x1={o.x} y1={o.y}
          x2={keeperX} y2={keeperY}
          stroke="var(--foer-border-dim)"
          strokeWidth={1}
        />
      ))}

      {/* Intake session orbs */}
      {intakeOrbs.map((o, i) => (
        <circle key={i} cx={o.x} cy={o.y} r={7} fill="#5FA9AE" fillOpacity={0.5} />
      ))}

      {/* Intake ambient glow */}
      <ellipse cx={intakeX} cy={intakeY} rx={52} ry={62} fill="url(#intakeGlow)" />

      {/* Keeper → Shelf lines for kept orbs */}
      {shelfOrbs.map((o, i) => (
        <line
          key={i}
          x1={keeperX} y1={keeperY}
          x2={o.x} y2={o.y}
          stroke={o.color}
          strokeWidth={1}
          strokeOpacity={0.4}
        />
      ))}

      {/* Keeper discard line (downward) */}
      {discarded > 0 && (
        <g>
          <line
            x1={keeperX} y1={keeperY}
            x2={keeperX} y2={H - 20}
            stroke="var(--foer-text-mut)"
            strokeWidth={1}
            strokeDasharray="3 3"
            strokeOpacity={0.4}
          />
          <text x={keeperX + 5} y={H - 8} fontFamily={MONO} fontSize={8} fill="var(--foer-text-mut)">
            {discarded} discarded
          </text>
        </g>
      )}

      {/* Keeper glow */}
      <ellipse cx={keeperX} cy={keeperY} rx={42} ry={42} fill="url(#keeperGlow)" />

      {/* Keeper node */}
      <circle cx={keeperX} cy={keeperY} r={18} fill="var(--foer-card-bg)" stroke={GOLD} strokeWidth={1.5} />
      <text x={keeperX} y={keeperY - 3} textAnchor="middle" fontFamily={MONO} fontSize={7} fill={GOLD} letterSpacing="0.5">KEEPER</text>
      <text x={keeperX} y={keeperY + 8} textAnchor="middle" fontFamily={MONO} fontSize={8} fill={GOLD} fontWeight={600}>
        {memoriesKept}
      </text>

      {/* Phantoms blocked */}
      {phantomsBlocked > 0 && (
        <g>
          <line
            x1={keeperX + 20} y1={keeperY - 10}
            x2={keeperX + 60} y2={keeperY - 40}
            stroke={RULE_TYPE_COLORS.SOURCE_PREF}
            strokeWidth={1}
            strokeDasharray="2 3"
            strokeOpacity={0.5}
          />
          <circle cx={keeperX + 64} cy={keeperY - 42} r={5} fill={RULE_TYPE_COLORS.SOURCE_PREF} fillOpacity={0.3} stroke={RULE_TYPE_COLORS.SOURCE_PREF} strokeWidth={0.8} />
          <text x={keeperX + 72} y={keeperY - 38} fontFamily={MONO} fontSize={7.5} fill={RULE_TYPE_COLORS.SOURCE_PREF}>
            {phantomsBlocked}×phantom
          </text>
        </g>
      )}

      {/* Shelf orbs */}
      {shelfOrbs.map((o, i) => (
        <g key={i}>
          <circle
            cx={o.x}
            cy={o.y}
            r={Math.max(7, Math.round(o.conf * 10))}
            fill={o.color}
            fillOpacity={0.85}
            style={{ filter: `drop-shadow(0 0 5px ${o.color}66)` }}
          />
        </g>
      ))}

      {/* Rule type legend */}
      {(['HARD_RULE', 'FAILURE_MODE', 'HEURISTIC', 'SOURCE_PREF'] as const).map((rt, i) => {
        const c = ruleTypeColor(rt);
        const count = bullets.filter(b => b.ruleType === rt).length;
        if (count === 0) return null;
        return (
          <g key={rt}>
            <circle cx={10} cy={H - 60 + i * 14} r={4} fill={c} fillOpacity={0.85} />
            <text x={18} y={H - 56 + i * 14} fontFamily={MONO} fontSize={7.5} fill="var(--foer-text-mut)">
              {ruleTypeLabel(rt)} · {count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function KeeperChoicePanel() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<number>(7);

  const { data, isLoading, isError } = useQuery<KeeperSummaryResponse>({
    queryKey: ['foer-keeper-summary', windowDays],
    queryFn: async () => {
      const res = await fetch(`/api/agent-lab/memory/keeper-summary?days=${windowDays}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.json() as Promise<KeeperSummaryResponse>;
    },
    staleTime: 60_000,
  });

  const bullets = useMemo(
    () =>
      [...(data?.bullets ?? [])].sort((a, b) => {
        const oa = RULE_TYPE_ORDER[a.ruleType] ?? 99;
        const ob = RULE_TYPE_ORDER[b.ruleType] ?? 99;
        return oa !== ob ? oa - ob : b.confidence - a.confidence;
      }),
    [data],
  );

  if (isLoading) {
    return (
      <section style={{ padding: '56px 0', borderTop: '1px solid var(--foer-border)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '180px',
            borderRadius: 6,
            border: '1px solid var(--foer-border-dim)',
            background: 'var(--foer-surface)',
            gap: '0.5rem',
            fontFamily: MONO,
            fontSize: '0.75rem',
            color: 'var(--foer-text-sec)',
          }}
        >
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--foer-gold)' }} />
          Loading…
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section style={{ padding: '56px 0', borderTop: '1px solid var(--foer-border)' }}>
        <div
          style={{
            borderRadius: 6,
            border: `1px solid ${RULE_TYPE_COLORS.FAILURE_MODE}30`,
            background: `${RULE_TYPE_COLORS.FAILURE_MODE}10`,
            color: RULE_TYPE_COLORS.FAILURE_MODE,
            fontFamily: MONO,
            fontSize: '0.75rem',
            padding: '1rem',
          }}
        >
          Failed to load keeper summary.
        </div>
      </section>
    );
  }

  const isEmpty  = !data || data.runsCount === 0;
  const sessions = data?.sessionsScanned  ?? 0;
  const analyzed = data?.memoriesAnalyzed ?? 0;
  const kept     = data?.memoriesKept     ?? 0;
  const phantoms = data?.phantomsBlocked  ?? 0;
  const discarded = data?.discarded       ?? 0;

  return (
    <section
      style={{
        padding:   '56px 0',
        borderTop: '1px solid var(--foer-border)',
      }}
    >
      {/* Section kicker */}
      <div style={{
        fontFamily:    MONO,
        fontSize:      '10.5px',
        letterSpacing: '0.22em',
        color:         'var(--foer-text-mut)',
        textTransform: 'uppercase',
        marginBottom:  '14px',
        display:       'flex',
        alignItems:    'center',
        gap:           '10px',
      }}>
        <span style={{ color: GOLD }}>03</span> · SENSE · DISTIL · TRACE
      </div>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
        <h2 style={{
          fontFamily:    SERIF,
          fontWeight:    600,
          fontSize:      '30px',
          color:         'var(--foer-text-pri)',
          letterSpacing: '-0.01em',
          margin:        0,
        }}>
          The Keeper&apos;s Choice
        </h2>
        <div style={{ display: 'flex', gap: '0.35rem', alignSelf: 'center' }}>
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              className="foer-filter-btn"
              data-active={windowDays === w.days ? 'true' : 'false'}
              onClick={() => setWindowDays(w.days)}
              style={windowDays === w.days ? { borderColor: GOLD, color: GOLD } : undefined}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <p style={{
        color:      'var(--foer-text-sec)',
        fontSize:   '15px',
        maxWidth:   '680px',
        margin:     '0 0 24px',
        lineHeight: 1.5,
      }}>
        {isEmpty
          ? `No distillation runs in the last ${windowDays} days.`
          : `In the last ${windowDays}d — ${sessions} session${sessions !== 1 ? 's' : ''} · ${analyzed} memories analyzed · ${kept} kept.`}
      </p>

      {/* Two-column layout */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: '1fr 1fr',
          gap:                 '20px',
          alignItems:          'start',
        }}
      >
        {/* Left: trace graph */}
        <div>
          {isEmpty ? (
            <div
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                minHeight:      '300px',
                borderRadius:   6,
                border:         '1px dashed var(--foer-border-dim)',
                background:     'var(--foer-surface)',
                fontFamily:     MONO,
                fontSize:       '0.72rem',
                color:          'var(--foer-text-mut)',
              }}
            >
              Awaiting first run…
            </div>
          ) : (
            <TraceGraph
              bullets={bullets}
              sessionsScanned={sessions}
              memoriesAnalyzed={analyzed}
              memoriesKept={kept}
              phantomsBlocked={phantoms}
            />
          )}

          {/* Stats strip below graph */}
          {!isEmpty && (
            <div style={{
              display:    'flex',
              flexWrap:   'wrap',
              gap:        '4px 14px',
              marginTop:  '10px',
              fontFamily: MONO,
              fontSize:   '0.68rem',
              color:      'var(--foer-text-sec)',
            }}>
              <span>{sessions} <span style={{ color: 'var(--foer-text-mut)' }}>sessions</span></span>
              <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
              <span>{analyzed} <span style={{ color: 'var(--foer-text-mut)' }}>analyzed</span></span>
              <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
              <span style={{ color: GOLD, fontWeight: 600 }}>{kept}</span>
              <span style={{ color: 'var(--foer-text-mut)' }}>kept</span>
              <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
              <span style={{ color: RULE_TYPE_COLORS.SOURCE_PREF }}>{phantoms}</span>
              <span style={{ color: 'var(--foer-text-mut)' }}>phantoms</span>
              <span style={{ color: 'var(--foer-text-mut)' }}>·</span>
              <span>{discarded} <span style={{ color: 'var(--foer-text-mut)' }}>discarded</span></span>
            </div>
          )}
        </div>

        {/* Right: keeper weighs panel */}
        <div
          style={{
            borderRadius: 6,
            border:       '1px solid var(--foer-border)',
            background:   'var(--foer-card-bg)',
            overflow:     'hidden',
          }}
        >
          {/* Panel header */}
          <div style={{
            padding:      '0.9rem 1.25rem',
            borderBottom: '1px solid var(--foer-border-dim)',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--foer-text-mut)' }}>
              The Keeper weighs
            </span>
            {!isEmpty && (
              <span style={{ fontFamily: MONO, fontSize: '0.65rem', color: GOLD }}>
                {bullets.length} rule{bullets.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Empty states */}
          {isEmpty && (
            <div style={{ padding: '2rem', textAlign: 'center', fontFamily: MONO, fontSize: '0.72rem', color: 'var(--foer-text-mut)' }}>
              No runs in this window.
            </div>
          )}
          {!isEmpty && bullets.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', fontFamily: MONO, fontSize: '0.72rem', color: 'var(--foer-text-mut)' }}>
              No memory bullets retained.
            </div>
          )}

          {/* Bullet list — summary view, expand for detail */}
          {!isEmpty && bullets.length > 0 && (
            <div
              style={{
                display:        'flex',
                flexDirection:  'column',
                maxHeight:      '340px',
                overflowY:      'auto',
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--foer-border) transparent',
              }}
            >
              {bullets.map((bullet, idx) => {
                const accent    = ruleTypeColor(bullet.ruleType);
                const isExpanded = expandedId === bullet.id;
                const isLast    = idx === bullets.length - 1;
                const shortText = summarise(bullet.ruleText);
                const needsExpand = bullet.ruleText.length > shortText.length || !!bullet.rationale;

                return (
                  <div
                    key={bullet.id}
                    style={{
                      borderBottom: isLast ? 'none' : '1px solid var(--foer-border-dim)',
                      borderLeft:   `3px solid ${accent}`,
                      padding:      '0.7rem 1rem',
                      cursor:       needsExpand ? 'pointer' : 'default',
                      transition:   'background 0.15s',
                    }}
                    onMouseEnter={(e) => { if (needsExpand) e.currentTarget.style.background = 'var(--foer-surface2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    onClick={() => needsExpand && setExpandedId(isExpanded ? null : bullet.id)}
                  >
                    {/* Badge + confidence */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                      {/* Pictorial dot */}
                      <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true" style={{ flexShrink: 0 }}>
                        <circle cx="3.5" cy="3.5" r="3.5" fill={accent} />
                      </svg>

                      {/* Text badge */}
                      <span
                        style={{
                          fontFamily:    MONO,
                          fontSize:      '0.60rem',
                          fontWeight:    600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          color:         accent,
                          background:    `${accent}12`,
                          border:        `1px solid ${accent}35`,
                          borderRadius:  3,
                          padding:       '1px 4px',
                          whiteSpace:    'nowrap',
                          flexShrink:    0,
                        }}
                      >
                        {ruleTypeLabel(bullet.ruleType)}
                      </span>

                      <span style={{ fontFamily: MONO, fontSize: '0.60rem', color: 'var(--foer-text-mut)', whiteSpace: 'nowrap' }}>
                        {(bullet.confidence * 100).toFixed(0)}%
                      </span>

                      <div style={{ flex: 1 }} />
                      {needsExpand && (
                        isExpanded
                          ? <ChevronUp   size={11} style={{ color: 'var(--foer-text-mut)', flexShrink: 0 }} />
                          : <ChevronDown size={11} style={{ color: 'var(--foer-text-mut)', flexShrink: 0 }} />
                      )}
                    </div>

                    {/* Summary text — short one-liner */}
                    <p
                      style={{
                        fontFamily: BODY,
                        fontSize:   '0.78rem',
                        color:      'var(--foer-text-pri)',
                        lineHeight: 1.5,
                        margin:     0,
                      }}
                    >
                      {isExpanded ? bullet.ruleText : shortText}
                    </p>

                    {/* Rationale — only when expanded */}
                    {isExpanded && bullet.rationale && (
                      <p
                        style={{
                          fontFamily:   SERIF,
                          fontSize:     '0.72rem',
                          fontStyle:    'italic',
                          color:        'var(--foer-text-sec)',
                          lineHeight:   1.5,
                          marginTop:    '0.45rem',
                          paddingTop:   '0.45rem',
                          borderTop:    '1px solid var(--foer-border-dim)',
                          marginBottom: 0,
                        }}
                      >
                        {bullet.rationale}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer quote */}
          <div style={{ padding: '0.65rem 1.25rem', borderTop: '1px solid var(--foer-border-dim)', textAlign: 'center' }}>
            <p style={{ fontFamily: SERIF, fontSize: '0.65rem', fontStyle: 'italic', color: 'var(--foer-text-mut)', margin: 0 }}>
              &ldquo;Failures become rules in the imperative. A retry loop becomes nothing.&rdquo;
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
