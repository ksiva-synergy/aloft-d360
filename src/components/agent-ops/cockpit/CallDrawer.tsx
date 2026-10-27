'use client';

import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { InvocationRow } from '@/lib/agent-ops/session-cockpit';
import { extractSqlFromInput } from '../SqlPreview';
import { BORDER, ERR, OK, type ColorOf, fmtMs, mono, sans, stringify } from './format';
import { Chip, CodeBlock } from './ui';

export interface DrawerState {
  items: InvocationRow[];
  index: number;
  title?: string;
}

const SQL_KEYWORDS = new Set(
  (
    'select from where and or not as with on join left right inner outer full cross group by order having limit offset union all ' +
    'distinct case when then else end in is null like ilike between exists over partition row_number rank dense_rank count sum avg ' +
    'min max coalesce cast desc asc insert into values update set delete create table view lateral using qualify interval true false'
  ).split(' '),
);

/** Lightweight SQL tokenizer for readable highlighting — no dependency needed. */
function HighlightedSql({ sql }: { sql: string }) {
  const parts: React.ReactNode[] = [];
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|([(),;*=<>!]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(sql))) {
    if (m.index > last) parts.push(sql.slice(last, m.index));
    const [tok] = m;
    let color: string | undefined;
    let weight: number | undefined;
    if (m[1]) color = 'var(--ink-3)';
    else if (m[2]) color = '#16a34a';
    else if (m[3]) color = '#d97706';
    else if (m[4] && SQL_KEYWORDS.has(tok.toLowerCase())) {
      color = 'var(--brand-a)';
      weight = 600;
    } else if (m[5]) color = 'var(--ink-3)';
    parts.push(
      color ? (
        <span key={k++} style={{ color, fontWeight: weight }}>
          {tok}
        </span>
      ) : (
        tok
      ),
    );
    last = m.index + tok.length;
  }
  if (last < sql.length) parts.push(sql.slice(last));
  return <>{parts}</>;
}

export function CallDrawer({ state, onClose, onIndex, colorOf }: { state: DrawerState | null; onClose: () => void; onIndex: (i: number) => void; colorOf: ColorOf }) {
  const inv = state ? state.items[state.index] : null;

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if ((e.key === 'ArrowDown' || e.key === 'j') && state.index < state.items.length - 1) {
        e.preventDefault();
        onIndex(state.index + 1);
      } else if ((e.key === 'ArrowUp' || e.key === 'k') && state.index > 0) {
        e.preventDefault();
        onIndex(state.index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onClose, onIndex]);

  const navBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    borderRadius: 8,
    border: BORDER,
    background: 'transparent',
    color: 'var(--wb-ink-dim)',
    cursor: 'pointer',
  };

  return (
    <AnimatePresence>
      {state && inv && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 60 }}
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-label="Tool call details"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 34, stiffness: 380 }}
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(720px, 100vw)',
              background: 'var(--wb-canvas)',
              borderLeft: BORDER,
              boxShadow: '-12px 0 40px rgba(0,0,0,0.18)',
              zIndex: 61,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Detail inv={inv} state={state} onClose={onClose} onIndex={onIndex} colorOf={colorOf} navBtn={navBtn} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Detail({
  inv,
  state,
  onClose,
  onIndex,
  colorOf,
  navBtn,
}: {
  inv: InvocationRow;
  state: DrawerState;
  onClose: () => void;
  onIndex: (i: number) => void;
  colorOf: ColorOf;
  navBtn: React.CSSProperties;
}) {
  const ok = inv.status === 'success';
  const sql = extractSqlFromInput(inv.input as Record<string, unknown> | undefined);
  const inputText = stringify(inv.input);
  const outputText = stringify(inv.output);

  return (
    <>
      <header style={{ padding: '16px 20px', borderBottom: BORDER, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ ...sans, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)' }}>
            {state.title ?? 'Tool call'} · {state.index + 1} of {state.items.length}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" aria-label="Previous call" disabled={state.index === 0} onClick={() => onIndex(state.index - 1)} style={{ ...navBtn, opacity: state.index === 0 ? 0.4 : 1 }}>
              <ChevronUp size={16} />
            </button>
            <button
              type="button"
              aria-label="Next call"
              disabled={state.index >= state.items.length - 1}
              onClick={() => onIndex(state.index + 1)}
              style={{ ...navBtn, opacity: state.index >= state.items.length - 1 ? 0.4 : 1 }}
            >
              <ChevronDown size={16} />
            </button>
            <button type="button" aria-label="Close" onClick={onClose} style={navBtn}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: colorOf(inv.toolName) }} />
          <h3 style={{ ...mono, fontSize: 'var(--type-title-section-size)', fontWeight: 500, margin: 0, color: 'var(--wb-ink)' }}>{inv.toolName}</h3>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          <Chip color={ok ? OK : ERR}>{inv.status}</Chip>
          <Chip>{fmtMs(inv.durationMs)}</Chip>
          <Chip>turn {inv.turnIndex || '—'}</Chip>
          {inv.loop > 0 && <Chip>loop {inv.loop}</Chip>}
          {inv.model && <Chip color="var(--brand-a)">{inv.model}</Chip>}
          {inv.createdAt && <Chip>{new Date(inv.createdAt).toLocaleTimeString()}</Chip>}
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 24px' }}>
        {inv.error && (
          <div
            style={{
              ...mono,
              fontSize: 'var(--type-caption-size)',
              color: ERR,
              padding: 12,
              marginTop: 16,
              borderRadius: 8,
              border: `1px solid color-mix(in srgb, ${ERR} 35%, transparent)`,
              background: `color-mix(in srgb, ${ERR} 8%, transparent)`,
              whiteSpace: 'pre-wrap',
            }}
          >
            {inv.error}
          </div>
        )}
        {sql && (
          <CodeBlock label="SQL" text={sql}>
            <HighlightedSql sql={sql} />
          </CodeBlock>
        )}
        {inputText && !sql && <CodeBlock label="Input" text={inputText} />}
        {outputText ? (
          <CodeBlock label="Output" text={outputText} />
        ) : (
          <p style={{ ...sans, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', marginTop: 16 }}>No output was recorded for this call.</p>
        )}
        {inputText && sql && <CodeBlock label="Raw input" text={inputText} />}
      </div>

      <footer style={{ ...sans, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', padding: '10px 20px', borderTop: BORDER }}>
        <kbd style={{ ...mono }}>↑</kbd> <kbd style={{ ...mono }}>↓</kbd> to step through calls · <kbd style={{ ...mono }}>Esc</kbd> to close
      </footer>
    </>
  );
}
