'use client';

// DataReadinessRing — the DATA readiness card on the Estate object page.
//
// Three columns (stack on narrow screens):
//   1. Ring: four arcs (one per dimension) around the level + composite score.
//   2. Dimensions: full name, score bar, %, and the top reason for each.
//   3. What's holding it back: the gating dimension's reasons, each linked to
//      the place on the page where it can be fixed, plus the next level.
//
// Colours: scoreColor() for dimension severity, levelColor() for the centre
// level only (see dataReadinessColors.ts). Text uses theme tokens.

import React from 'react';
import { scoreColor, levelColor } from './dataReadinessColors';
import { type, inkOf } from '@/lib/typography/tokens';

const TRACK_COLOR = 'color-mix(in srgb, var(--ink-1) 8%, transparent)';

const DIMS = ['discoverable', 'accessible', 'trusted', 'actionable'] as const;
type Dim = (typeof DIMS)[number];

const DIMENSION_LABELS: Record<Dim, string> = {
  discoverable: 'Discoverable',
  accessible:   'Accessible',
  trusted:      'Trusted',
  actionable:   'Actionable',
};

const DIMENSION_QUESTION: Record<Dim, string> = {
  discoverable: 'Can people find and understand it?',
  accessible:   'Can it be queried safely?',
  trusted:      'Is it fresh, stable and reviewed?',
  actionable:   'Is it connected and used?',
};

const LEVEL_NAMES: Record<string, string> = {
  L1: 'Inventoried',
  L2: 'Profiled',
  L3: 'Understood',
  L4: 'Curated',
  L5: 'Operationalized',
};

const NEXT_LEVEL: Record<string, string | null> = { L1: 'L2', L2: 'L3', L3: 'L4', L4: 'L5', L5: null };

const SEGMENT_STARTS: Record<Dim, number> = {
  discoverable: -90,
  accessible:    0,
  trusted:       90,
  actionable:    180,
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  if (sweepDeg <= 0) return '';
  const clampedSweep = Math.min(sweepDeg, 359.99);
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, startDeg + clampedSweep);
  const largeArc = clampedSweep > 180 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

export interface DataScoreShape {
  discoverable: { score: number; reasons: string[] };
  accessible:   { score: number; reasons: string[] };
  trusted:      { score: number; reasons: string[] };
  actionable:   { score: number; reasons: string[] };
  composite: number;
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  gating_dimension: 'discoverable' | 'accessible' | 'trusted' | 'actionable';
}

interface DataReadinessRingProps {
  dataScore: DataScoreShape | undefined;
  ringRef?: React.RefObject<HTMLDivElement>;
}

/** Where on the page a reason can be acted on. Matched on the reason text from data-score. */
function actionFor(reason: string): { label: string; href: string } | null {
  const r = reason.toLowerCase();
  if (r.includes("'assumed'") || r.includes('not yet human-validated')) return { label: 'Review description', href: '#semantic-card' };
  if (r.includes('no semantic card') || r.includes('t2')) return { label: 'Describe it', href: '#overview' };
  if (r.includes('changed in') || r.includes('drift')) return { label: 'See what changed', href: '#operations' };
  if (r.includes('source altered') || r.includes('outdated') || r.includes('stale')) return { label: 'Check freshness', href: '#operations' };
  if (r.includes('pii')) return { label: 'Review columns', href: '#columns' };
  if (r.includes('usage') || r.includes('t3')) return { label: 'View usage', href: '#usage' };
  if (r.includes('relationship') || r.includes('mapping') || r.includes('link')) return { label: 'Review relationships', href: '#relationships' };
  return null;
}

// ── Ring ─────────────────────────────────────────────────────────────────────

const SIZE = 148;
const CX = SIZE / 2;
const R = 58;
const STROKE = 10;
const GAP_DEG = 5;

function Ring({ dataScore }: { dataScore: DataScoreShape | undefined }) {
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
      aria-label={dataScore ? `Level ${dataScore.level}, ${Math.round(dataScore.composite * 100)}% ready` : 'Readiness loading'}>
      {DIMS.map((dim) => {
        const start = SEGMENT_STARTS[dim] + GAP_DEG / 2;
        const max = 90 - GAP_DEG;
        const score = dataScore?.[dim].score ?? 0;
        const track = arcPath(CX, CX, R, start, max);
        const fill = score > 0 ? arcPath(CX, CX, R, start, score * max) : '';
        return (
          <g key={dim}>
            <title>{`${DIMENSION_LABELS[dim]} ${Math.round(score * 100)}%`}</title>
            {track && <path d={track} fill="none" stroke={TRACK_COLOR} strokeWidth={STROKE} strokeLinecap="round" />}
            {fill && <path d={fill} fill="none" stroke={scoreColor(score)} strokeWidth={STROKE} strokeLinecap="round" />}
          </g>
        );
      })}
    </svg>
  );
}

// ── Dimension row ────────────────────────────────────────────────────────────

function DimensionRow({ dim, score, reasons, gating }: { dim: Dim; score: number; reasons: string[]; gating: boolean }) {
  const pct = Math.round(score * 100);
  const color = scoreColor(score);
  const topReason = reasons[0] ?? null;
  return (
    <div title={DIMENSION_QUESTION[dim]} style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ ...type.ui, color: 'var(--estate-ink)', fontWeight: 600 }}>{DIMENSION_LABELS[dim]}</span>
        {gating && (
          <span
            style={{
              ...type.caption,
              color: inkOf(color),
              background: `color-mix(in srgb, ${color} 12%, transparent)`,
              borderRadius: 999,
              padding: '0 7px',
            }}
          >
            gating
          </span>
        )}
        <span style={{ ...type['kpi-sm'], color: inkOf(color), marginLeft: 'auto' }}>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: TRACK_COLOR, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.5s ease' }} />
      </div>
      <div
        style={{
          ...type.caption,
          color: 'var(--estate-text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={topReason ?? undefined}
      >
        {topReason ?? 'No issues found'}
      </div>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export default function DataReadinessRing({ dataScore, ringRef }: DataReadinessRingProps) {
  const level = dataScore?.level ?? null;
  const centerColor = level ? levelColor(level) : 'var(--estate-text-muted)';
  const gatingDim = dataScore?.gating_dimension ?? null;
  const gatingReasons = gatingDim && dataScore ? dataScore[gatingDim].reasons : [];
  const next = level ? NEXT_LEVEL[level] : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
        gap: '24px 36px',
        alignItems: 'center',
      }}
    >
      {/* 1 — Ring with level in the centre */}
      <div ref={ringRef} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
          <Ring dataScore={dataScore} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ ...type['kpi-lg'], color: centerColor }}>{level ?? '—'}</span>
            <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>
              {dataScore ? `${Math.round(dataScore.composite * 100)}% ready` : 'loading'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>DATA readiness</span>
          <span style={{ ...type['title-card'], color: 'var(--estate-ink)' }}>{level ? LEVEL_NAMES[level] : '—'}</span>
          {next && (
            <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>
              Next: {next} · {LEVEL_NAMES[next]}
            </span>
          )}
        </div>
      </div>

      {/* 2 — Dimensions */}
      {dataScore && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px 24px' }}>
          {DIMS.map((dim) => (
            <DimensionRow
              key={dim}
              dim={dim}
              score={dataScore[dim].score}
              reasons={dataScore[dim].reasons}
              gating={dim === gatingDim}
            />
          ))}
        </div>
      )}

      {/* 3 — What's holding it back */}
      {dataScore && gatingDim && (
        <div
          style={{
            alignSelf: 'stretch',
            borderRadius: 10,
            padding: '14px 16px',
            background: 'color-mix(in srgb, var(--brand-a) 5%, var(--estate-raised))',
            border: '1px solid color-mix(in srgb, var(--brand-a) 18%, transparent)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ ...type.ui, color: 'var(--estate-ink)', fontWeight: 600 }}>
            {next
              ? <>What&apos;s holding it at {dataScore.level}</>
              : <>Fully operational</>}
          </div>
          {next && (
            <div style={{ ...type.caption, color: 'var(--estate-text-muted)', marginTop: -6 }}>
              {DIMENSION_LABELS[gatingDim]} is the lowest dimension
            </div>
          )}
          {gatingReasons.length === 0 ? (
            <div style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>No open issues.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {gatingReasons.slice(0, 4).map((reason, i) => {
                const action = actionFor(reason);
                return (
                  <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>{reason}</span>
                    {action && (
                      <a
                        href={action.href}
                        className="hover:underline"
                        style={{ ...type.ui, color: 'var(--brand-a-ink)', fontWeight: 600, textDecoration: 'none', width: 'fit-content' }}
                      >
                        {action.label} →
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
