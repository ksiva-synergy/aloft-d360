'use client';

import React, { useRef, useEffect } from 'react';
import type { QueryResult } from '@/hooks/useInspectorChat';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DatasetRailProps {
  results: QueryResult[];
  selectedIndex: number;
  onSelect: (i: number) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const NUMERIC_TYPES = new Set(['LONG', 'INT', 'INTEGER', 'DECIMAL', 'DOUBLE', 'FLOAT', 'SHORT', 'BYTE']);
const SPARKLINE_HEIGHT = 24;
const SPARKLINE_WIDTH = 232; // approx width inside entry (280px rail - 2*24px padding)

// ── SparklineCanvas ───────────────────────────────────────────────────────────
function SparklineCanvas({ columns, rows }: { columns: QueryResult['columns']; rows: QueryResult['rows'] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Find first numeric column
  const numericCol = columns.find(c => NUMERIC_TYPES.has(c.type_name));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !numericCol) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Sample up to 100 values
    const step = Math.max(1, Math.floor(rows.length / 100));
    const values: number[] = [];
    for (let i = 0; i < rows.length; i += step) {
      const raw = rows[i][numericCol.name];
      const n = parseFloat(String(raw ?? ''));
      if (!isNaN(n)) values.push(n);
    }

    if (values.length < 2) return;

    const w = canvas.width;
    const h = canvas.height;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#FDB515';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [rows, numericCol]);

  if (!numericCol) {
    return (
      <span
        style={{
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 10,
          color: 'var(--builder-text-label)',
        }}
      >
        —
      </span>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      style={{ display: 'block', width: '100%', height: SPARKLINE_HEIGHT }}
    />
  );
}

// ── DatasetRail ───────────────────────────────────────────────────────────────
export function DatasetRail({ results, selectedIndex, onSelect }: DatasetRailProps) {
  // Display in reverse order: newest first
  const displayOrder = Array.from({ length: results.length }, (_, i) => results.length - 1 - i);

  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--builder-border)',
        background: 'var(--builder-surface)',
        overflow: 'hidden',
      }}
    >
      {/* Rail header */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--builder-border)',
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--builder-text-label)',
          flexShrink: 0,
        }}
      >
        DATASETS · {results.length} RESULT{results.length !== 1 ? 'S' : ''}
      </div>

      {/* Result entries */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {displayOrder.map(i => {
          const result = results[i];
          const isSelected = i === selectedIndex;
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(i)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
              style={{
                position: 'relative',
                cursor: 'pointer',
                padding: '12px 16px',
                borderBottom: '1px solid var(--builder-border)',
                background: isSelected ? 'var(--builder-surface-raised)' : 'transparent',
                minHeight: 120,
                boxSizing: 'border-box',
                outline: 'none',
              }}
              onFocus={e => {
                e.currentTarget.style.outline = '1px solid rgba(253,181,21,0.5)';
                e.currentTarget.style.outlineOffset = '-2px';
              }}
              onBlur={e => {
                e.currentTarget.style.outline = 'none';
              }}
              onMouseEnter={e => {
                if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--builder-surface)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--builder-surface-raised)' : 'transparent';
              }}
            >
              {/* Gold left rule — exact StagingSidebar.tsx pattern */}
              {isSelected && (
                <span
                  className="absolute left-0 top-[7px] bottom-[7px] w-[2.5px] rounded-full"
                  style={{ background: '#FDB515' }}
                />
              )}

              {/* Query badge row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                    fontSize: 10,
                    padding: '1px 5px',
                    borderRadius: 2,
                    border: isSelected ? '1px solid var(--builder-gold)' : '1px solid var(--builder-border)',
                    color: isSelected ? 'var(--builder-gold)' : 'var(--builder-text-label)',
                    letterSpacing: '0.06em',
                  }}
                >
                  Q{i + 1}
                </span>
                {result.truncated && (
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontSize: 10,
                      padding: '1px 4px',
                      borderRadius: 2,
                      border: '1px solid rgba(248,113,113,0.4)',
                      color: '#f87171',
                      letterSpacing: '0.06em',
                    }}
                  >
                    TRUNCATED
                  </span>
                )}
              </div>

              {/* SQL preview */}
              <p
                style={{
                  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                  fontSize: 11,
                  color: 'var(--builder-text-muted)',
                  margin: '0 0 4px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {result.sql.slice(0, 60)}
              </p>

              {/* Metadata row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                    fontSize: 10,
                    color: 'var(--builder-text-label)',
                  }}
                >
                  {result.rowCount.toLocaleString()} rows × {result.columns.length} cols
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                    fontSize: 10,
                    color: 'var(--builder-text-label)',
                  }}
                >
                  JUST NOW
                </span>
              </div>

              {/* Sparkline */}
              <SparklineCanvas columns={result.columns} rows={result.rows} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
