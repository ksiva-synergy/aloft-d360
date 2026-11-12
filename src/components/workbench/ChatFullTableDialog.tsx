'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import type { QueryResult } from '@/hooks/useInspectorChat';
import { filterQueryRowIndices } from '@/lib/workbench/query-table-filter';
import { type } from '@/lib/typography/tokens';

const INK = 'var(--wb-ink)';
const MUTED = 'var(--wb-muted)';
const LINE = 'var(--wb-border-subtle)';
const GOLD = 'var(--brand-a-ink)';
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const sans: React.CSSProperties = { fontFamily: 'var(--font-sans)' };

export function ChatFullTableDialog({
  result,
  title,
  onClose,
}: {
  result: QueryResult;
  title?: string;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const visible = useMemo(
    () => filterQueryRowIndices(result.rows, result.columns, filter).map((i) => result.rows[i]),
    [result.rows, result.columns, filter],
  );
  const filterActive = filter.trim().length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const heading = title ?? 'Query results';
  const total = result.rowCount;
  const loaded = result.rows.length;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'color-mix(in srgb, var(--wb-ink) 55%, transparent)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 'min(1100px, 100%)',
          maxHeight: 'min(88vh, 900px)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 12,
          border: `1px solid ${LINE}`,
          background: 'var(--surface-1)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: `1px solid ${LINE}`,
            flexShrink: 0,
          }}
        >
          <h2 style={{ ...type['body-lg'], fontWeight: 600, color: INK, margin: 0, flex: 1 }}>{heading}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 280px', maxWidth: 360 }}>
            <Search size={14} style={{ color: MUTED, flexShrink: 0 }} aria-hidden />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search all columns…"
              aria-label="Search table"
              autoFocus
              style={{
                ...type['ui-regular'],
                flex: 1,
                minWidth: 0,
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid ${LINE}`,
                background: 'var(--wb-canvas)',
                color: INK,
              }}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              border: 'none',
              borderRadius: 8,
              background: 'transparent',
              cursor: 'pointer',
              color: MUTED,
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', ...sans }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--type-ui-regular-size)', lineHeight: 1.45 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface-1)' }}>
              <tr>
                {result.columns.map((col) => (
                  <th
                    key={col.name}
                    style={{
                      ...type.label,
                      color: GOLD,
                      textAlign: 'left',
                      padding: '10px 14px',
                      borderBottom: `1px solid ${LINE}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={result.columns.length}
                    style={{ padding: 24, textAlign: 'center', color: MUTED }}
                  >
                    {filterActive ? 'No rows match your search.' : 'No rows.'}
                  </td>
                </tr>
              ) : (
                visible.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--wb-ink) 3%, transparent)' }}>
                    {result.columns.map((col) => {
                      const raw = row[col.name];
                      const text = raw == null ? '—' : String(raw);
                      return (
                        <td
                          key={col.name}
                          style={{
                            padding: '8px 14px',
                            borderBottom: `1px solid ${LINE}`,
                            color: raw == null ? MUTED : INK,
                            verticalAlign: 'top',
                            maxWidth: 320,
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                          }}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '10px 16px',
            borderTop: `1px solid ${LINE}`,
            flexShrink: 0,
            ...mono,
            fontSize: 'var(--type-ui-regular-size)',
            color: MUTED,
          }}
        >
          <span>
            {filterActive
              ? `${visible.length} of ${loaded} loaded rows match`
              : `Showing ${loaded.toLocaleString()} row${loaded === 1 ? '' : 's'}`}
            {total > loaded ? ` · ${total.toLocaleString()} total from query` : ''}
          </span>
          {result.truncated && (
            <span style={{ color: GOLD }}>
              Row limit reached — use CSV export for the full extract.
            </span>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
