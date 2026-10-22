'use client';

import React, { useMemo, useState } from 'react';
import type { InvocationRow } from '@/lib/agent-ops/session-cockpit';
import { BORDER, ERR, type ColorOf, fmtMs, mono, sans } from './format';

interface Bar {
  inv: InvocationRow;
  index: number;
  start: number;
  end: number;
}

/**
 * Gantt-style view of every tool call. Uses wall-clock timestamps when the audit log has them
 * (created_at is written when a call finishes, so start = end − duration); otherwise lays calls
 * end-to-end in call order so relative cost is still visible.
 */
export function Waterfall({ calls, colorOf, onOpen }: { calls: InvocationRow[]; colorOf: ColorOf; onOpen: (index: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);

  const { bars, span, wallClock } = useMemo(() => {
    const stamped = calls.every((c) => c.createdAt && new Date(c.createdAt).getTime() > 0);
    const out: Bar[] = [];
    if (stamped && calls.length > 0) {
      const ends = calls.map((c) => new Date(c.createdAt).getTime());
      const t0 = Math.min(...calls.map((c, i) => ends[i] - c.durationMs));
      calls.forEach((c, i) => out.push({ inv: c, index: i, start: ends[i] - c.durationMs - t0, end: ends[i] - t0 }));
    } else {
      let t = 0;
      calls.forEach((c, i) => {
        const d = Math.max(c.durationMs, 1);
        out.push({ inv: c, index: i, start: t, end: t + d });
        t += d;
      });
    }
    return { bars: out, span: Math.max(...out.map((b) => b.end), 1), wallClock: stamped };
  }, [calls]);

  if (calls.length === 0) return <p style={{ ...sans, fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>No tool calls to plot.</p>;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const LABEL_W = 190;

  return (
    <div>
      <p style={{ ...sans, fontSize: 11, color: 'var(--ink-3)', margin: '0 0 10px' }}>
        {wallClock
          ? 'Real clock time. Gaps between bars are time spent by the model thinking between calls.'
          : 'This run has no timestamps, so calls are laid end to end in order. Bar length is the call’s duration.'}
      </p>

      {/* axis */}
      <div style={{ display: 'grid', gridTemplateColumns: `${LABEL_W}px minmax(0, 1fr)`, gap: 10, marginBottom: 4 }}>
        <span />
        <div style={{ position: 'relative', height: 16 }}>
          {ticks.map((f) => (
            <span
              key={f}
              style={{
                ...mono,
                position: 'absolute',
                left: `${f * 100}%`,
                transform: f === 0 ? 'none' : f === 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                fontSize: 10,
                color: 'var(--ink-3)',
              }}
            >
              {fmtMs(span * f)}
            </span>
          ))}
        </div>
      </div>

      <div style={{ maxHeight: 520, overflowY: 'auto', borderTop: BORDER }}>
        {bars.map((b, i) => {
          const newTurn = i === 0 || bars[i - 1].inv.turnIndex !== b.inv.turnIndex;
          const ok = b.inv.status === 'success';
          const color = ok ? colorOf(b.inv.toolName) : ERR;
          const active = hover === i;
          return (
            <React.Fragment key={b.inv.id}>
              {newTurn && (
                <div style={{ ...sans, fontSize: 11, fontWeight: 600, color: 'var(--wb-ink-dim)', padding: '8px 0 4px', borderBottom: BORDER }}>
                  Turn {b.inv.turnIndex || '—'}
                </div>
              )}
              <button
                type="button"
                onClick={() => onOpen(b.index)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `${LABEL_W}px minmax(0, 1fr)`,
                  gap: 10,
                  alignItems: 'center',
                  width: '100%',
                  height: 26,
                  padding: 0,
                  border: 'none',
                  background: active ? 'color-mix(in srgb, var(--brand-a) 7%, transparent)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ ...mono, fontSize: 11, color: active ? 'var(--wb-ink)' : 'var(--wb-ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 4 }}>
                  <span style={{ color: 'var(--ink-3)' }}>{String(b.index + 1).padStart(2, '0')}</span> {b.inv.toolName}
                </span>
                <span style={{ position: 'relative', height: '100%' }}>
                  {ticks.slice(1, -1).map((f) => (
                    <span key={f} style={{ position: 'absolute', left: `${f * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--wb-border-subtle)' }} />
                  ))}
                  <span
                    style={{
                      position: 'absolute',
                      top: 7,
                      height: 12,
                      left: `${(b.start / span) * 100}%`,
                      width: `max(3px, ${((b.end - b.start) / span) * 100}%)`,
                      borderRadius: 3,
                      background: color,
                      opacity: hover == null || active ? 1 : 0.55,
                      transition: 'opacity 120ms',
                    }}
                  />
                  {active && (
                    <span
                      style={{
                        ...mono,
                        position: 'absolute',
                        top: 6,
                        left: `calc(${(b.end / span) * 100}% + 6px)`,
                        fontSize: 10,
                        color: 'var(--wb-ink)',
                        whiteSpace: 'nowrap',
                        transform: b.end / span > 0.8 ? 'translateX(calc(-100% - 12px))' : 'none',
                      }}
                    >
                      {fmtMs(b.inv.durationMs)}
                    </span>
                  )}
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
