'use client';

import React, { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { BORDER, CARD_BG, ERR, OK, mono, sans } from './format';

export function SectionTitle({ children, hint, right }: { children: React.ReactNode; hint?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ ...sans, fontSize: 15, fontWeight: 600, color: 'var(--wb-ink)', margin: 0 }}>{children}</h2>
        {hint && <p style={{ ...sans, fontSize: 12, color: 'var(--ink-3)', margin: '3px 0 0' }}>{hint}</p>}
      </div>
      {right}
    </div>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section style={{ border: BORDER, borderRadius: 14, background: CARD_BG, padding: 18, minWidth: 0, ...style }}>{children}</section>
  );
}

export function Chip({ children, color, title }: { children: React.ReactNode; color?: string; title?: string }) {
  const c = color ?? 'var(--ink-3)';
  return (
    <span
      title={title}
      style={{
        ...mono,
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
        background: `color-mix(in srgb, ${c} 8%, transparent)`,
        color: color ?? 'var(--wb-ink-dim)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function StatusDot({ ok, size = 8 }: { ok: boolean; size?: number }) {
  return (
    <span
      aria-label={ok ? 'success' : 'error'}
      style={{ width: size, height: size, borderRadius: '50%', background: ok ? OK : ERR, flexShrink: 0, display: 'inline-block' }}
    />
  );
}

/** Horizontal multi-part bar, e.g. input vs output tokens. */
export function SplitBar({ parts }: { parts: { value: number; color: string; label: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--wb-border-subtle)', marginTop: 10 }}>
      {parts.map((p) => (
        <div key={p.label} title={`${p.label}: ${p.value.toLocaleString()}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  footer,
  accent,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  footer?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div style={{ position: 'relative', padding: '14px 16px', borderRadius: 12, border: BORDER, background: CARD_BG, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent ?? 'var(--brand-a)', opacity: 0.8 }} />
      <div style={{ ...sans, fontSize: 12, color: 'var(--ink-3)' }}>{label}</div>
      <div style={{ ...mono, fontSize: 22, fontWeight: 500, color: 'var(--wb-ink)', marginTop: 4, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ ...mono, fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>}
      {footer}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    });
  }, [text]);
  return (
    <button
      type="button"
      onClick={onCopy}
      style={{
        ...sans,
        fontSize: 11,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 6,
        border: BORDER,
        background: 'transparent',
        color: done ? OK : 'var(--wb-ink-dim)',
        cursor: 'pointer',
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function CodeBlock({ label, text, children }: { label: string; text: string; children?: React.ReactNode }) {
  const max = 6000;
  const shown = text.length > max ? `${text.slice(0, max)}…` : text;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ ...sans, fontSize: 12, fontWeight: 600, color: 'var(--wb-ink-dim)' }}>{label}</span>
        <CopyButton text={text} />
      </div>
      <pre
        style={{
          ...mono,
          fontSize: 12,
          lineHeight: 1.55,
          margin: 0,
          padding: 12,
          borderRadius: 8,
          border: BORDER,
          background: 'color-mix(in srgb, var(--wb-ink) 5%, transparent)',
          color: 'var(--wb-ink-dim)',
          maxHeight: 420,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {children ?? shown}
      </pre>
    </div>
  );
}
