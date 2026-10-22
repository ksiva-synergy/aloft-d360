'use client';

import React, { useState } from 'react';
import type { TraceToolSpan } from '@/lib/agent-ops/types';
import { SqlPreview, extractSqlFromInput } from './SqlPreview';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

const STATUS_COLOR: Record<string, string> = {
  suggested: 'var(--ink-3)',
  running: '#f59e0b',
  success: '#22c55e',
  error: '#D9774B',
};

export function ToolSpanRow({ span }: { span: TraceToolSpan }) {
  const [open, setOpen] = useState(false);
  const rail = STATUS_COLOR[span.status] ?? 'var(--ink-3)';
  const sql = extractSqlFromInput(span.input);

  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0' }}>
      <div
        style={{
          width: 3,
          borderRadius: 2,
          background: rail,
          flexShrink: 0,
          animation: span.status === 'running' ? 'pulse 1.2s ease-in-out infinite' : undefined,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ ...mono, fontSize: 12, color: 'var(--wb-ink)', flex: 1 }}>{span.toolName}</span>
          {span.durationMs != null && span.durationMs > 0 && (
            <span
              style={{
                ...mono,
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--ink-1) 6%, transparent)',
                color: 'var(--ink-3)',
              }}
            >
              {span.durationMs}ms
            </span>
          )}
          <span style={{ ...mono, fontSize: 10, color: rail, textTransform: 'uppercase' }}>{span.status}</span>
        </button>
        {span.error && (
          <div style={{ ...mono, fontSize: 11, color: '#D9774B', marginTop: 4 }}>{span.error}</div>
        )}
        {open && (
          <div style={{ marginTop: 6 }}>
            {sql && <SqlPreview sql={sql} />}
            {!sql && span.input && (
              <pre
                style={{
                  ...mono,
                  fontSize: 10,
                  margin: 0,
                  padding: 8,
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.2)',
                  overflow: 'auto',
                  maxHeight: 160,
                }}
              >
                {JSON.stringify(span.input, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
