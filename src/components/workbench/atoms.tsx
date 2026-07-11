import React from 'react';

// ── Dot ──────────────────────────────────────────────────────
export interface DotProps { c?: string; s?: number; }
export function Dot({ c = 'var(--gold)', s = 6 }: DotProps) {
  return (
    <span style={{
      width: s, height: s,
      background: c,
      display: 'inline-block',
      flexShrink: 0,
    }} />
  );
}

// ── RingDot ───────────────────────────────────────────────────
export interface RingDotProps { c?: string; s?: number; }
export function RingDot({ c = 'var(--border-bright)', s = 8 }: RingDotProps) {
  return (
    <span style={{
      width: s, height: s,
      border: `1px solid ${c}`,
      display: 'inline-block',
      flexShrink: 0,
      borderRadius: '50%',
    }} />
  );
}

// ── AloftSigil ────────────────────────────────────────────────
export interface AloftSigilProps { size?: number; glow?: boolean; }
export function AloftSigil({ size = 40, glow = false }: AloftSigilProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      {/* outer ring */}
      <rect
        x="20" y="6"
        width="19.8" height="19.8"
        rx="0"
        transform="rotate(45 20 20)"
        stroke="var(--sigil-stroke, var(--gold))"
        strokeWidth="1.25"
        fill="none"
      />
      {/* inner fill */}
      <rect
        x="20" y="13"
        width="9.9" height="9.9"
        rx="0"
        transform="rotate(45 20 20)"
        fill="var(--sigil-fill, var(--gold))"
        opacity={glow ? 1 : 0.9}
      />
      {/* 4 tick lines */}
      <line x1="20" y1="2"  x2="20" y2="5"  stroke="var(--sigil-stroke, var(--gold))" strokeWidth="1" />
      <line x1="20" y1="35" x2="20" y2="38" stroke="var(--sigil-stroke, var(--gold))" strokeWidth="1" />
      <line x1="2"  y1="20" x2="5"  y2="20" stroke="var(--sigil-stroke, var(--gold))" strokeWidth="1" />
      <line x1="35" y1="20" x2="38" y2="20" stroke="var(--sigil-stroke, var(--gold))" strokeWidth="1" />
    </svg>
  );
}

// ── CornerBracket ─────────────────────────────────────────────
export type CornerPos = 'tl' | 'tr' | 'bl' | 'br';
export interface CornerBracketProps { pos: CornerPos; size?: number; color?: string; }
export function CornerBracket({ pos, size = 10, color = 'var(--border-bright)' }: CornerBracketProps) {
  const borderTop    = pos === 'tl' || pos === 'tr' ? `1px solid ${color}` : 'none';
  const borderBottom = pos === 'bl' || pos === 'br' ? `1px solid ${color}` : 'none';
  const borderLeft   = pos === 'tl' || pos === 'bl' ? `1px solid ${color}` : 'none';
  const borderRight  = pos === 'tr' || pos === 'br' ? `1px solid ${color}` : 'none';
  const top    = pos === 'tl' || pos === 'tr' ? 0 : undefined;
  const bottom = pos === 'bl' || pos === 'br' ? 0 : undefined;
  const left   = pos === 'tl' || pos === 'bl' ? 0 : undefined;
  const right  = pos === 'tr' || pos === 'br' ? 0 : undefined;
  return (
    <span style={{
      position: 'absolute',
      width: size, height: size,
      borderTop, borderBottom, borderLeft, borderRight,
      top, bottom, left, right,
    }} />
  );
}

// ── Bracketed ─────────────────────────────────────────────────
export interface BracketedProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}
export function Bracketed({ children, style, className }: BracketedProps) {
  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <CornerBracket pos="tl" />
      <CornerBracket pos="tr" />
      <CornerBracket pos="bl" />
      <CornerBracket pos="br" />
      {children}
    </div>
  );
}

// ── Cursor ────────────────────────────────────────────────────
export function Cursor() {
  return (
    <span style={{
      display: 'inline-block',
      width: 6, height: 10,
      background: 'var(--gold)',
      animation: 'blink 1s step-end infinite',
      verticalAlign: 'middle',
      marginLeft: 2,
      flexShrink: 0,
    }} />
  );
}

// ── ProgressBar ───────────────────────────────────────────────
export interface ProgressBarProps { pct: number; }
export function ProgressBar({ pct }: ProgressBarProps) {
  return (
    <div style={{
      width: 80, height: 4,
      background: 'var(--border)',
      borderRadius: 2,
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, pct))}%`,
        height: '100%',
        background: 'var(--gold)',
        borderRadius: 2,
        transition: 'width 0.3s ease',
      }} />
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────
export function Spinner() {
  return (
    <svg
      width="12" height="12"
      viewBox="0 0 12 12"
      style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}
    >
      <circle cx="6" cy="6" r="5" stroke="var(--spinner-track)" strokeWidth="2" fill="none" />
      <path
        d="M6 1 A5 5 0 0 1 11 6"
        stroke="var(--spinner-head)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── StatusBadge ───────────────────────────────────────────────
export interface StatusBadgeProps { s: string; }
export function StatusBadge({ s }: StatusBadgeProps) {
  const upper = s.toUpperCase();
  let bg = 'transparent';
  let color = 'var(--label)';
  let border = 'none';

  if (upper === 'LIVE') {
    bg = '#052010';
    color = 'var(--green)';
    border = '1px solid var(--green)';
  } else if (upper === 'PREVIEW') {
    bg = '#1A1200';
    color = 'var(--amber)';
    border = '1px solid var(--amber)';
  } else if (upper === 'COMING SOON') {
    bg = 'transparent';
    color = 'var(--label)';
    border = '1px dashed var(--border-bright)';
  }

  return (
    <span style={{
      fontFamily: 'var(--mono)',
      fontSize: 9,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      padding: '2px 6px',
      borderRadius: 3,
      background: bg,
      color,
      border,
      flexShrink: 0,
      whiteSpace: 'nowrap',
    }}>
      {upper}
    </span>
  );
}

// ── Check ─────────────────────────────────────────────────────
export interface CheckProps { ok: boolean; label: string; }
export function Check({ ok, label }: CheckProps) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontFamily: 'var(--mono)',
      fontSize: 9,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      padding: '1px 5px',
      borderRadius: 3,
      border: ok ? '1px solid var(--green)' : '1px solid var(--border)',
      color: ok ? 'var(--green)' : 'var(--label)',
      background: 'transparent',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {ok ? '✓' : '○'} {label}
    </span>
  );
}

// ── MetaCell ──────────────────────────────────────────────────
export interface MetaCellProps { k: string; v: string; accent?: boolean; }
export function MetaCell({ k, v, accent = false }: MetaCellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{
        fontSize: 8,
        fontFamily: 'var(--mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: 'var(--label)',
      }}>
        {k}
      </span>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontFamily: 'var(--mono)',
        color: accent ? 'var(--green)' : 'var(--text)',
      }}>
        {accent && (
          <span style={{
            width: 5, height: 5,
            background: 'var(--green)',
            borderRadius: '50%',
            animation: 'pulse 1.5s ease-in-out infinite',
            flexShrink: 0,
          }} />
        )}
        {v}
      </span>
    </div>
  );
}
