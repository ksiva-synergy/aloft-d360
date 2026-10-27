'use client';

import React from 'react';
import type { ToolAnalyticsRow } from '@/lib/agent-ops/session-cockpit';
import { BORDER, ERR, OK, WARN, type ColorOf, fmtMs, mono, plural, sans } from './format';

/** One bar per tool showing its share of total tool time. */
export function ToolTimeBreakdown({
  rows,
  colorOf,
  onSelect,
  selected,
}: {
  rows: ToolAnalyticsRow[];
  colorOf: ColorOf;
  onSelect?: (name: string) => void;
  selected?: string | null;
}) {
  if (rows.length === 0) return <p style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: 'var(--ink-3)', margin: 0 }}>No tool calls recorded yet.</p>;
  const totalTime = rows.reduce((s, r) => s + r.totalDurationMs, 0) || 1;
  const sorted = [...rows].sort((x, y) => y.totalDurationMs - x.totalDurationMs);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* stacked overview bar */}
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, marginBottom: 10 }}>
        {sorted.map((r) => (
          <span key={r.toolName} title={`${r.toolName}: ${fmtMs(r.totalDurationMs)}`} style={{ flex: Math.max(r.totalDurationMs, 1), background: colorOf(r.toolName) }} />
        ))}
      </div>
      {sorted.map((r) => {
        const share = r.totalDurationMs / totalTime;
        const isSel = selected === r.toolName;
        return (
          <button
            key={r.toolName}
            type="button"
            onClick={() => onSelect?.(r.toolName)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px, 1.2fr) minmax(80px, 2fr) auto',
              alignItems: 'center',
              gap: 14,
              width: '100%',
              padding: '10px',
              borderRadius: 8,
              border: isSel ? '1px solid color-mix(in srgb, var(--brand-a) 45%, transparent)' : '1px solid transparent',
              background: isSel ? 'color-mix(in srgb, var(--brand-a) 8%, transparent)' : 'transparent',
              cursor: onSelect ? 'pointer' : 'default',
              textAlign: 'left',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: colorOf(r.toolName), flexShrink: 0 }} />
                <span style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--wb-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.toolName}</span>
              </div>
              <div style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', marginTop: 3, paddingLeft: 18 }}>
                {plural(r.calls, 'call')} · avg {fmtMs(r.avgDurationMs)} · max {fmtMs(r.maxDurationMs)}
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--wb-border-subtle)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(share * 100, 2)}%`, height: '100%', background: colorOf(r.toolName), borderRadius: 4 }} />
            </div>
            <div style={{ textAlign: 'right', minWidth: 92 }}>
              <div style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--wb-ink)' }}>{fmtMs(r.totalDurationMs)}</div>
              <div style={{ ...mono, fontSize: 'var(--type-caption-size)', color: r.errors > 0 ? ERR : 'var(--ink-3)', marginTop: 3 }}>
                {(share * 100).toFixed(0)}% · {r.errors > 0 ? `${r.errors} err` : `${(r.successRate * 100).toFixed(0)}% ok`}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ToolTable({ rows, onSelect, selected }: { rows: ToolAnalyticsRow[]; onSelect?: (name: string) => void; selected?: string | null }) {
  if (rows.length === 0) return <p style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: 'var(--ink-3)', margin: 0 }}>No tool calls recorded yet.</p>;
  const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 500, textAlign: 'right' };
  const td: React.CSSProperties = { padding: '9px 10px', textAlign: 'right' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 'var(--type-caption-size)' }}>
        <thead>
          <tr style={{ ...sans, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', borderBottom: BORDER }}>
            <th style={{ ...th, textAlign: 'left' }}>Tool</th>
            <th style={th}>Calls</th>
            <th style={th}>Errors</th>
            <th style={th}>Success</th>
            <th style={th}>Avg</th>
            <th style={th}>Max</th>
            <th style={th}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.toolName}
              onClick={() => onSelect?.(r.toolName)}
              style={{
                cursor: onSelect ? 'pointer' : 'default',
                borderBottom: BORDER,
                background: selected === r.toolName ? 'color-mix(in srgb, var(--brand-a) 8%, transparent)' : undefined,
              }}
            >
              <td style={{ ...td, textAlign: 'left', color: 'var(--brand-a)' }}>{r.toolName}</td>
              <td style={td}>{r.calls}</td>
              <td style={{ ...td, color: r.errors > 0 ? ERR : 'var(--ink-3)' }}>{r.errors}</td>
              <td style={{ ...td, color: r.successRate < 1 ? WARN : OK }}>{(r.successRate * 100).toFixed(0)}%</td>
              <td style={td}>{fmtMs(r.avgDurationMs)}</td>
              <td style={td}>{fmtMs(r.maxDurationMs)}</td>
              <td style={td}>{fmtMs(r.totalDurationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
