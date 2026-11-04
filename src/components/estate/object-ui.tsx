'use client';

// object-ui — shared building blocks for the Estate object page so every card
// reads the same way: one card shell, one tag, one callout, one code block,
// one labelled field. Theme tokens only (light + dark + brand themes);
// typography from src/lib/typography/tokens (no literal sizes — CI guard).

import React from 'react';
import { type, inkOf } from '@/lib/typography/tokens';

// ── Tones ────────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'brand' | 'blue' | 'green' | 'amber' | 'red' | 'violet';

/** Base hue per tone. Text uses inkOf() so small text stays readable on both themes. */
export const TONE_COLOR: Record<Exclude<Tone, 'neutral' | 'brand'>, string> = {
  blue:   '#2F6DB0',
  green:  '#3B7A4B',
  amber:  '#B4801A',
  red:    '#B23A32',
  violet: '#7C5CC4',
};

export function toneStyles(tone: Tone): { fg: string; bg: string; border: string; solid: string } {
  if (tone === 'neutral') {
    return {
      fg: 'var(--estate-text-secondary)',
      bg: 'var(--estate-active-bg)',
      border: 'var(--estate-border)',
      solid: 'var(--estate-text-muted)',
    };
  }
  const c = tone === 'brand' ? 'var(--brand-a)' : TONE_COLOR[tone];
  return {
    fg: tone === 'brand' ? 'var(--brand-a-ink)' : inkOf(c),
    bg: `color-mix(in srgb, ${c} 10%, transparent)`,
    border: `color-mix(in srgb, ${c} 28%, transparent)`,
    solid: c,
  };
}

// ── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  title?: React.ReactNode;
  /** Small icon / glyph before the title. */
  icon?: React.ReactNode;
  /** Muted text after the title (counts, timestamps). */
  meta?: React.ReactNode;
  /** Right side of the header (chips, buttons). */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Remove body padding (tables, graphs that run edge to edge). */
  flush?: boolean;
  /** Accent the card border (e.g. stale state). */
  tone?: Tone;
  id?: string;
  style?: React.CSSProperties;
}

export function Card({ title, icon, meta, actions, children, flush, tone, id, style }: CardProps) {
  const accent = tone && tone !== 'neutral' ? toneStyles(tone).border : 'var(--estate-border)';
  return (
    <section
      id={id}
      style={{
        background: 'var(--estate-raised)',
        border: `1px solid ${accent}`,
        borderRadius: 12,
        overflow: 'hidden',
        minWidth: 0,
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            padding: '14px 20px',
            borderBottom: '1px solid var(--estate-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {icon && <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--estate-text-muted)' }}>{icon}</span>}
            {title && <h3 style={{ ...type['title-card'], color: 'var(--estate-ink)', margin: 0 }}>{title}</h3>}
            {meta && <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{meta}</span>}
          </div>
          {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        </header>
      )}
      <div style={flush ? undefined : { padding: '18px 20px' }}>{children}</div>
    </section>
  );
}

/** A labelled block inside a card body, separated from the previous block by a hairline. */
export function CardBlock({ label, aside, children, first }: { label?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...(first ? {} : { borderTop: '1px solid var(--estate-border)', paddingTop: 16, marginTop: 16 }),
      }}
    >
      {(label || aside) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {label && <FieldLabel>{label}</FieldLabel>}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>{children}</span>;
}

/** Label over value. */
export function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <FieldLabel>{label}</FieldLabel>
      <div style={{ ...type.ui, color: 'var(--estate-ink)', minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ── Tag ──────────────────────────────────────────────────────────────────────

interface TagProps {
  tone?: Tone;
  mono?: boolean;
  /** Filled dot before the text. */
  dot?: boolean;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

export function Tag({ tone = 'neutral', mono, dot, title, onClick, children }: TagProps) {
  const t = toneStyles(tone);
  const style: React.CSSProperties = {
    ...(mono ? type['code-inline'] : type.caption),
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 22,
    padding: '1px 8px',
    borderRadius: 6,
    color: t.fg,
    background: t.bg,
    border: `1px solid ${t.border}`,
    whiteSpace: 'nowrap',
    fontWeight: mono ? undefined : 600,
    cursor: onClick ? 'pointer' : undefined,
  };
  const content = (
    <>
      {dot && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: t.solid, flexShrink: 0 }} />}
      {children}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} title={title} style={style} className="transition-opacity hover:opacity-80">{content}</button>
    : <span title={title} style={style}>{content}</span>;
}

// ── Callout ──────────────────────────────────────────────────────────────────

interface CalloutProps {
  tone?: Tone;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

export function Callout({ tone = 'neutral', icon, title, action, children }: CalloutProps) {
  const t = toneStyles(tone);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 10,
        background: t.bg,
        border: `1px solid ${t.border}`,
      }}
    >
      {icon && <span aria-hidden="true" style={{ color: t.fg, flexShrink: 0, lineHeight: 1.4 }}>{icon}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        {title && <div style={{ ...type.ui, fontWeight: 600, color: t.fg }}>{title}</div>}
        {children && <div style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>{children}</div>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

// ── Code block ───────────────────────────────────────────────────────────────

export function CodeBlock({ code, maxHeight = 260 }: { code: string; maxHeight?: number }) {
  return (
    <pre
      style={{
        ...type.code,
        margin: 0,
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--estate-bg)',
        border: '1px solid var(--estate-border)',
        color: 'var(--estate-ink)',
        overflow: 'auto',
        maxHeight,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      <code>{code}</code>
    </pre>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export const BTN_SECONDARY =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-size-ui font-medium transition-colors hover:bg-[var(--estate-active-bg)] disabled:cursor-not-allowed disabled:opacity-60 border-[var(--estate-btn-border)] bg-[var(--estate-raised)] text-[var(--estate-ink)]';

export const BTN_PRIMARY =
  'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-size-ui font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 bg-[var(--brand-a)]';

export const BTN_GHOST =
  'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-size-ui font-medium transition-colors hover:bg-[var(--estate-active-bg)] text-[var(--brand-a-ink)]';

// ── Empty ────────────────────────────────────────────────────────────────────

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...type.ui,
        color: 'var(--estate-text-muted)',
        padding: '20px 16px',
        textAlign: 'center',
        border: '1px dashed var(--estate-border)',
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  );
}

// ── Time helpers ─────────────────────────────────────────────────────────────

export function relTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return 'Never';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fullTime(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? undefined
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export { inkOf };
