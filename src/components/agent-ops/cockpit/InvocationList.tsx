'use client';

import React from 'react';
import type { InvocationRow } from '@/lib/agent-ops/session-cockpit';
import { BORDER, ERR, type ColorOf, fmtMs, mono, plural, sans, summarizeInput } from './format';
import { StatusDot } from './ui';

/** Compact one-line rows. Clicking a row opens the call inspector with the whole list for ↑/↓ stepping. */
export function InvocationList({
  items,
  colorOf,
  onOpen,
  highlightTool,
  groupByTurn = false,
}: {
  items: InvocationRow[];
  colorOf: ColorOf;
  onOpen: (items: InvocationRow[], index: number) => void;
  highlightTool?: string | null;
  groupByTurn?: boolean;
}) {
  const filtered = highlightTool ? items.filter((i) => i.toolName === highlightTool) : items;
  const maxDuration = filtered.reduce((m, i) => Math.max(m, i.durationMs), 0);
  if (filtered.length === 0) {
    return <p style={{ ...sans, fontSize: 13, color: 'var(--ink-3)', padding: '12px 4px', margin: 0 }}>No invocations.</p>;
  }

  const row = (inv: InvocationRow, idx: number) => {
    const ok = inv.status === 'success';
    const hint = summarizeInput(inv.input);
    return (
      <button
        key={inv.id}
        type="button"
        onClick={() => onOpen(filtered, idx)}
        style={{
          display: 'grid',
          gridTemplateColumns: '30px minmax(0, 1fr) 80px 60px',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '9px 10px',
          border: 'none',
          borderBottom: BORDER,
          borderLeft: `3px solid ${ok ? 'transparent' : ERR}`,
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--brand-a) 6%, transparent)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ ...mono, fontSize: 10, color: 'var(--ink-3)' }}>T{inv.turnIndex || '—'}</span>
        <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot ok={ok} />
          <span style={{ ...mono, fontSize: 12, color: 'var(--wb-ink)', flexShrink: 0 }}>{inv.toolName}</span>
          {hint && <span style={{ ...mono, fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</span>}
        </span>
        <span style={{ height: 6, borderRadius: 3, background: 'var(--wb-border-subtle)', overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${Math.max((inv.durationMs / (maxDuration || 1)) * 100, 3)}%`, background: ok ? colorOf(inv.toolName) : ERR }} />
        </span>
        <span style={{ ...mono, fontSize: 11, color: 'var(--wb-ink-dim)', textAlign: 'right' }}>{fmtMs(inv.durationMs)}</span>
      </button>
    );
  };

  if (!groupByTurn) return <div style={{ borderTop: BORDER }}>{filtered.map(row)}</div>;

  const groups: { turn: number; start: number; items: InvocationRow[] }[] = [];
  filtered.forEach((inv, idx) => {
    const last = groups[groups.length - 1];
    if (last && last.turn === inv.turnIndex) last.items.push(inv);
    else groups.push({ turn: inv.turnIndex, start: idx, items: [inv] });
  });
  return (
    <div>
      {groups.map((g) => (
        <div key={`${g.turn}-${g.start}`} style={{ marginBottom: 14 }}>
          <div style={{ ...sans, fontSize: 12, fontWeight: 600, color: 'var(--wb-ink-dim)', padding: '6px 4px' }}>
            Turn {g.turn || '—'} <span style={{ ...mono, fontWeight: 400, color: 'var(--ink-3)' }}>· {plural(g.items.length, 'call')}</span>
          </div>
          <div style={{ borderTop: BORDER }}>{g.items.map((inv, j) => row(inv, g.start + j))}</div>
        </div>
      ))}
    </div>
  );
}
