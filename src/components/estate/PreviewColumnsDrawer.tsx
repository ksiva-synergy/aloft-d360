'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Column {
  column_name: string;
  data_type: string;
  comment: string | null;
  ordinal_position: number;
  is_nullable: string;
}

interface PreviewColumnsDrawerProps {
  open: boolean;
  path: string;
  contextObjectId?: string | null;
  onClose: () => void;
  onHarvest: (paths: string[]) => void;
}

export default function PreviewColumnsDrawer({ open, path, contextObjectId, onClose, onHarvest }: PreviewColumnsDrawerProps) {
  const router = useRouter();
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !path) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/agent-lab/context/estate/preview-columns?path=${encodeURIComponent(path)}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          if (errData?.error === 'INSUFFICIENT_PERMISSIONS') {
            throw new Error(`INSUFFICIENT_PERMISSIONS:${errData?.catalog ?? ''}`);
          }
          if (errData?.error === 'EXTERNAL_SOURCE_UNREACHABLE') {
            throw new Error(`EXTERNAL_SOURCE_UNREACHABLE:${errData?.catalog ?? ''}:${errData?.remote ?? ''}`);
          }
          throw new Error(errData?.error ?? 'Failed to fetch columns');
        }
        const data = await res.json();
        setColumns(data.columns ?? []);
      } catch (err: any) {
        setError(err.message);
        setColumns([]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [open, path]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const borderColor = 'var(--estate-border)';
  const borderStrong = 'var(--estate-btn-border)';
  const surfaceBg = 'var(--estate-surface)';
  const inkColor = 'var(--estate-ink)';
  const textMuted = 'var(--estate-text-muted)';
  const textDim = 'var(--estate-text-dim)';
  const goldColor = '#FDB515';
  const goldDim = '#9a7a2a';

  return (
    <div className="pointer-events-none">
      {/* Scrim */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full w-[460px] max-w-[90vw] z-50 flex flex-col border-l pointer-events-auto"
        style={{
          backgroundColor: surfaceBg,
          borderColor: borderStrong,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
        }}
      >
        {/* Header */}
        <div className="relative px-5 py-5 border-b" style={{ borderColor }}>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-5 text-base hover:opacity-100 transition-opacity"
            style={{ color: textDim, opacity: 0.7 }}
          >
            ✕
          </button>
          <div
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.16em', textTransform: 'uppercase', color: textDim }}
          >
            Preview Columns · live
          </div>
          <div
            className="mt-2 break-all"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: inkColor }}
          >
            {path}
          </div>
          <div
            className="mt-2.5 flex gap-3"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', color: textDim }}
          >
            {loading ? (
              <span style={{ opacity: 0.5 }}>loading…</span>
            ) : (
              <span>{columns.length} columns</span>
            )}
          </div>
        </div>

        {/* Note */}
        <div
          className="px-5 py-2.5 border-b"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', color: goldDim, letterSpacing: '0.03em', borderColor }}
        >
          Live read from information_schema.columns — no harvest, no persistence.
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-1.5">
          {loading ? (
            <div className="space-y-0">
              {[...Array(8)].map((_, i) => (
                <div key={`skel-${i}`} className="px-5 py-3 border-b animate-pulse" style={{ borderColor }}>
                  <div className="flex justify-between">
                    <div className="h-4 bg-slate-400/15 rounded w-28" />
                    <div className="h-3.5 bg-slate-400/15 rounded w-14" />
                  </div>
                  <div className="h-3 bg-slate-400/10 rounded w-16 mt-2" />
                </div>
              ))}
            </div>
          ) : error ? (
            error.startsWith('INSUFFICIENT_PERMISSIONS:') ? (
              <div className="flex flex-col items-center gap-3 pt-12 text-center px-6">
                <span style={{ fontSize: '28px', lineHeight: 1 }}>🔒</span>
                <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: '13px', color: inkColor, fontWeight: 500 }}>
                  No catalog access
                </span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: textMuted, lineHeight: 1.6 }}>
                  The service account lacks <code>USE CATALOG</code> on{' '}
                  <span style={{ color: goldColor }}>{error.split(':')[1] || path.split('.')[0]}</span>.
                  <br />Grant the privilege in Databricks Unity Catalog and retry.
                </span>
              </div>
            ) : error.startsWith('EXTERNAL_SOURCE_UNREACHABLE:') ? (() => {
              const [, cat, remote] = error.split(':');
              return (
                <div className="flex flex-col items-center gap-3 pt-12 text-center px-6">
                  <span style={{ fontSize: '28px', lineHeight: 1 }}>🔌</span>
                  <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: '13px', color: inkColor, fontWeight: 500 }}>
                    External source unreachable
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: textMuted, lineHeight: 1.6 }}>
                    <span style={{ color: goldColor }}>{cat || path.split('.')[0]}</span> is a federated catalog.
                    <br />Databricks could not connect to the remote source
                    {remote ? <> (<span style={{ color: inkColor }}>{remote}</span>)</> : ''}.
                    <br />Check network / firewall rules on the external data source.
                  </span>
                </div>
              );
            })() : (
            <div className="flex flex-col items-center gap-3 pt-12 text-center px-5">
              <span className="text-lg opacity-40">⚠</span>
              <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: '13px', color: inkColor }}>
                Failed to load columns
              </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: textMuted }}>{error}</span>
            </div>
            )
          ) : (
            columns.map(col => (
              <div
                key={col.ordinal_position ?? col.column_name}
                className="grid gap-2 px-5 py-2.5 border-b"
                style={{ gridTemplateColumns: '1fr auto', borderColor }}
              >
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: inkColor }}>
                    {col.column_name}
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', color: textMuted, marginTop: '3px' }}>
                    {col.data_type}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className="text-[8.5px] tracking-wider uppercase px-1.5 py-0.5 rounded border"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: col.is_nullable === 'YES' ? textDim : textMuted,
                      borderColor: borderStrong,
                    }}
                  >
                    {col.is_nullable === 'YES' ? 'nullable' : 'not null'}
                  </span>
                </div>
                {col.comment && (
                  <div
                    style={{ gridColumn: '1 / 3', fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '12px', color: textDim, marginTop: '4px' }}
                  >
                    {col.comment}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 px-5 py-4 border-t" style={{ borderColor }}>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 text-center py-2.5 rounded-md border transition-colors"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', borderColor: borderStrong, color: textMuted, background: 'transparent' }}
          >
            Close
          </button>
          {contextObjectId ? (
            <button
              type="button"
              onClick={() => { onClose(); router.push(`/agent-lab/estate/object/${contextObjectId}`); }}
              className="flex-1 text-center py-2.5 rounded-md font-semibold transition-colors"
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', backgroundColor: goldColor, color: 'var(--estate-bg)' }}
            >
              ◆ View Full Detail
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { onHarvest([path]); onClose(); }}
              className="flex-1 text-center py-2.5 rounded-md font-semibold transition-colors"
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', backgroundColor: goldColor, color: 'var(--estate-bg)' }}
            >
              ⛏ Harvest this object
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
