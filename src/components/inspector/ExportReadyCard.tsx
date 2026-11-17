'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import type { ExportReadyMessage } from '@/hooks/useInspectorChat';
import { downloadInspectorCsv } from '@/lib/inspector/download-csv';
import { type } from '@/lib/typography/tokens';

const MONO: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
};
const GOLD = 'var(--brand-a)';
const MUTED = 'var(--ink-3)';

interface ExportReadyCardProps {
  message: ExportReadyMessage;
}

export function ExportReadyCard({ message }: ExportReadyCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await downloadInspectorCsv({
        sql: message.sql,
        filename: message.filename,
        maxRows: message.maxRows,
        toolSlug: message.toolSlug,
        sessionId: message.sessionId,
      });
      if (result.truncated) {
        setError('Truncated at row limit.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', minWidth: 0, marginTop: 6, marginBottom: 2 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: '100%',
          minHeight: 28,
          padding: '3px 6px 3px 8px',
          borderRadius: 6,
          border: '1px solid var(--wb-border-subtle, color-mix(in srgb, var(--ink-1) 12%, transparent))',
          background: 'var(--surface-1, color-mix(in srgb, var(--ink-1) 4%, transparent))',
        }}
      >
        <Download size={12} style={{ flexShrink: 0, color: MUTED }} aria-hidden />
        <code
          style={{
            ...MONO,
            ...type.ui,
            fontSize: 'var(--type-ui-size, 12px)',
            color: 'var(--ink-2)',
            flex: '1 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={message.filename}
        >
          {message.filename}
        </code>
        <button
          type="button"
          onClick={() => { void onDownload(); }}
          disabled={busy}
          aria-label={`Download ${message.filename}`}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            ...type.ui,
            fontSize: 'var(--type-ui-size, 12px)',
            fontWeight: 600,
            padding: '2px 6px',
            margin: 0,
            borderRadius: 4,
            border: 'none',
            background: busy ? 'color-mix(in srgb, var(--brand-a) 10%, transparent)' : 'transparent',
            color: GOLD,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? '…' : 'Download'}
        </button>
      </div>
      {error ? (
        <div style={{ ...MONO, fontSize: 11, color: error === 'Truncated at row limit.' ? MUTED : '#f87171', paddingLeft: 2 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default ExportReadyCard;