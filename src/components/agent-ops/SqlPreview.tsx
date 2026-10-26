'use client';

import React, { useCallback } from 'react';
import { type } from '@/lib/typography/tokens';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

export function extractSqlFromInput(input?: Record<string, unknown>): string | null {
  if (!input) return null;
  const args = input.args;
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const st = (args as Record<string, unknown>).statement;
    if (typeof st === 'string') return st;
  }
  if (typeof input.statement === 'string') return input.statement;
  if (typeof input.sql === 'string') return input.sql;
  return null;
}

export function SqlPreview({ sql, maxLen = 280 }: { sql: string; maxLen?: number }) {
  const truncated = sql.length > maxLen;
  const shown = truncated ? sql.slice(0, maxLen) + '…' : sql;

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(sql);
  }, [sql]);

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ ...type.label, }}>SQL</span>
        <button
          type="button"
          onClick={onCopy}
          style={{
            ...mono,
            fontSize: 9,
            background: 'transparent',
            border: '1px solid color-mix(in srgb, var(--brand-a) 25%, transparent)',
            color: 'var(--brand-a)',
            borderRadius: 4,
            padding: '2px 6px',
            cursor: 'pointer',
          }}
        >
          COPY
        </button>
      </div>
      <pre
        style={{
          ...mono,
          fontSize: 11,
          lineHeight: 1.45,
          margin: '4px 0 0',
          padding: 8,
          borderRadius: 6,
          background: 'rgba(0,0,0,0.25)',
          color: 'var(--wb-ink-dim)',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {shown}
      </pre>
    </div>
  );
}
