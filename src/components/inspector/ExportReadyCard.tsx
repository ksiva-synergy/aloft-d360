'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import type { ExportReadyMessage } from '@/hooks/useInspectorChat';
import { downloadInspectorCsv } from '@/lib/inspector/download-csv';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const GOLD = '#FDB515';
const MUTED = '#8892A4';

interface ExportReadyCardProps {
  message: ExportReadyMessage;
}

export function ExportReadyCard({ message }: ExportReadyCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
      setDone(true);
      if (result.truncated) {
        setError(
          `Download complete (truncated at ${message.maxRows.toLocaleString()} rows` +
            (result.totalRowCount != null
              ? `; warehouse reported ${result.totalRowCount.toLocaleString()}`
              : '') +
            ').',
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        marginBottom: 10,
        border: '1px solid rgba(253,181,21,0.28)',
        borderRadius: 8,
        background: 'rgba(253,181,21,0.06)',
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          ...MONO,
          fontSize: 10,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: GOLD,
          marginBottom: 6,
        }}
      >
        CSV export ready
      </div>
      <div style={{ fontSize: 13, color: 'var(--wb-ink, #e6ecf4)', marginBottom: 10, lineHeight: 1.45 }}>
        Download up to <strong>{message.maxRows.toLocaleString()}</strong> rows
        as <code style={{ ...MONO, fontSize: 12 }}>{message.filename}</code>.
        This re-runs the query on the warehouse (not the preview slice).
      </div>
      <button
        type="button"
        onClick={() => { void onDownload(); }}
        disabled={busy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          ...MONO,
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '7px 12px',
          borderRadius: 6,
          border: `1px solid ${GOLD}`,
          background: busy ? 'rgba(253,181,21,0.12)' : 'rgba(253,181,21,0.18)',
          color: GOLD,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        <Download size={14} />
        {busy ? 'Preparing…' : done ? 'Download again' : 'Download CSV'}
      </button>
      {error && (
        <div style={{ ...MONO, fontSize: 11, color: error.startsWith('Download complete') ? MUTED : '#f87171', marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default ExportReadyCard;
