'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { QueryResult } from '@/hooks/useInspectorChat';
import type { ChartSpec } from '@/lib/studio/types';
import { profileResultSet } from '@/lib/studio/profiler';
import { recommendCharts } from '@/lib/studio/recommender';
import { DatasetRail } from './DatasetRail';
import { DashboardGrid } from './DashboardGrid';
import { InsightRail } from './InsightRail';
import type { InsightCacheEntry, InsightResult } from './InsightRail';

export interface DataStudioProps {
  open: boolean;
  results: QueryResult[];
  onClose: () => void;
}

// ── No results guard ──────────────────────────────────────────────────────────
function NoResultsState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <span
        style={{
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 11,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'var(--builder-text-label)',
          textAlign: 'center',
          lineHeight: 1.8,
        }}
      >
        NO RESULTS YET
        <br />
        <span style={{ opacity: 0.6, fontSize: 10 }}>RUN A QUERY IN THE INSPECTOR</span>
      </span>
    </div>
  );
}

// ── DataStudio ────────────────────────────────────────────────────────────────
export function DataStudio({ open, results, onClose }: DataStudioProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canvasMode, setCanvasMode] = useState<'table' | 'dashboard'>('dashboard');
  // V3 — chart type overrides per dataset per card: overrides[resultIndex][specId]
  const [overrides, setOverrides] = useState<Record<number, Record<string, ChartSpec>>>({});
  // V4 — cached insight responses per dataset (keyed by resultIndex string)
  const [insightCache, setInsightCache] = useState<Record<string, InsightCacheEntry>>({});

  // Hydrate overrides and selectedIndex from persisted state on first results load
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || results.length === 0) return;
    // Use the last result that has cached overrides (most recent session state)
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].cachedChartOverrides) {
        setOverrides(results[i].cachedChartOverrides!);
        break;
      }
    }
    // Restore active result index (DO NOT auto-open DataStudio — user controls that)
    const lastWithIndex = [...results].reverse().find(r => typeof r.cachedActiveResultIndex === 'number');
    if (lastWithIndex?.cachedActiveResultIndex !== undefined) {
      const idx = Math.min(lastWithIndex.cachedActiveResultIndex, results.length - 1);
      if (idx >= 0) setSelectedIndex(idx);
    }
    hydratedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length > 0]);
  // V4 — columns to highlight across chart cards; cleared after 1.2s
  const [highlightedColumns, setHighlightedColumns] = useState<string[]>([]);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefersReducedMotion = useRef(false);
  const [visible, setVisible] = useState(false);
  // Focus trap: ref on the outermost content panel
  const dialogRef = useRef<HTMLDivElement>(null);

  // Detect prefers-reduced-motion once
  useEffect(() => {
    if (typeof window !== 'undefined') {
      prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  }, []);

  // Drive enter/exit transition
  useEffect(() => {
    if (open) {
      // Defer one frame so the initial opacity-0/scale-98 renders before transitioning
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    } else {
      setVisible(false);
    }
  }, [open]);

  // Scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Keyboard handler: ESC close, T toggle, ↑↓ rail nav, Tab focus trap
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // T toggle — skip if an input/textarea has focus
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === 't' || e.key === 'T') && !isInput) {
        e.preventDefault();
        setCanvasMode(m => m === 'table' ? 'dashboard' : 'table');
        return;
      }

      // ↑↓ rail navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(results.length - 1, i + 1));
        return;
      }

      // Tab focus trap — keep focus inside the dialog
      if (e.key === 'Tab') {
        const el = dialogRef.current;
        if (!el) return;
        const focusable = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) return;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, results.length]);

  // Auto-advance selectedIndex to newest result
  useEffect(() => {
    if (results.length > 0) {
      setSelectedIndex(prev => {
        const prevLastIdx = results.length - 2;
        if (prev === prevLastIdx || results.length === 1) return results.length - 1;
        return prev;
      });
    }
  }, [results.length]);

  // V4 — lifted profile + spec computation so InsightRail shares the same data as DashboardGrid
  // Use DB-cached profiles/specs if available to skip client-side computation
  const selectedResult = results.length > 0 ? results[selectedIndex] : null;
  const { profiles, specs, columnsTruncated } = useMemo(() => {
    if (!selectedResult || selectedResult.columns.length === 0) return { profiles: [], specs: [], columnsTruncated: false };
    // Return cached values from DB hydration if present
    if (selectedResult.cachedProfiles && selectedResult.cachedSpecs) {
      return {
        profiles: selectedResult.cachedProfiles,
        specs: selectedResult.cachedSpecs,
        columnsTruncated: selectedResult.columns.length > 50,
      };
    }
    const profileResult = profileResultSet(selectedResult.columns, selectedResult.rows);
    const baseSpecs = recommendCharts(profileResult, selectedResult.rows);
    return { profiles: profileResult.profiles, specs: baseSpecs, columnsTruncated: profileResult.columnsTruncated };
  // Include selectedIndex so memo invalidates when the selected dataset changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, selectedResult?.columns.length, selectedResult?.rows.length, selectedResult?.cachedProfiles, selectedResult?.cachedSpecs]);

  // Lazy-fill profiles+specs into DB after client-side computation
  useEffect(() => {
    if (!selectedResult?.persistedId) return;
    if (selectedResult.cachedProfiles && selectedResult.cachedSpecs) return; // already stored
    if (profiles.length === 0 || specs.length === 0) return;
    fetch(`/api/studio/results?id=${selectedResult.persistedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles, specs }),
    }).catch(() => {/* non-fatal */});
  // Run once per result + once profiles/specs are computed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedResult?.persistedId, profiles.length, specs.length]);

  // Persist chart_overrides and active_result_index whenever they change
  // so chart state survives session reload.
  useEffect(() => {
    if (!selectedResult?.persistedId) return;
    fetch(`/api/studio/results?id=${selectedResult.persistedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chart_overrides: overrides,
        active_result_index: selectedIndex,
      }),
    }).catch(() => {/* non-fatal */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedResult?.persistedId, selectedIndex, overrides]);

  // V4 — highlight columns in the dashboard, auto-clear after 1.2s
  const handleHighlight = (columns: string[]) => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedColumns(columns);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedColumns([]);
    }, prefersReducedMotion.current ? 1500 : 1200);
  };

  // SSR guard
  if (typeof window === 'undefined') return null;

  if (!open) return null;

  const n = results.length;
  const noResults = n === 0;

  const transition = prefersReducedMotion.current
    ? {}
    : {
        transition: 'opacity 150ms ease-out, transform 150ms ease-out',
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1)' : 'scale(0.98)',
      };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col"
      aria-modal="true"
      role="dialog"
      aria-label="Inspector Data Studio"
    >
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Content panel — focus trap root */}
      <div
        ref={dialogRef}
        className="relative flex flex-col w-full h-full"
        style={{
          background: 'var(--builder-bg)',
          borderRadius: 0,
          ...transition,
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            height: 48,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid var(--builder-border)',
            padding: '0 20px',
            gap: 8,
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          {/* Breadcrumb */}
          <span style={{ color: 'var(--builder-text-label)' }}>SPINOR</span>
          <span style={{ color: 'var(--builder-text-label)', opacity: 0.5 }}>/</span>
          <span style={{ color: 'var(--builder-text-label)' }}>INSPECTOR</span>
          <span style={{ color: 'var(--builder-text-label)', opacity: 0.5 }}>/</span>
          <span style={{ color: 'var(--builder-text)', fontWeight: 500 }}>DATA STUDIO</span>

          {/* Dataset count badge */}
          {n > 0 && (
            <>
              <span style={{ color: 'var(--builder-text-label)', opacity: 0.4, marginLeft: 4 }}>·</span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  color: 'var(--builder-gold)',
                  background: 'rgba(253,181,21,0.08)',
                  border: '1px solid rgba(253,181,21,0.2)',
                  borderRadius: 4,
                  padding: '2px 6px',
                }}
              >
                {n} DATASET{n !== 1 ? 'S' : ''}
              </span>
            </>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Close button */}
          <button
            onClick={onClose}
            title="Close Data Studio (ESC)"
            style={{
              border: '0.5px solid var(--builder-border-bright)',
              background: 'transparent',
              color: 'var(--builder-text-label)',
              borderRadius: '4px',
              padding: '2px 6px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            <X size={12} />
            CLOSE
          </button>
        </div>

        {/* ── Body ── */}
        {noResults ? (
          <NoResultsState />
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Dataset rail */}
            <DatasetRail
              results={results}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
            />

            {/* Main canvas */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              {selectedResult && (
                <StudioMainCanvas
                  result={selectedResult}
                  resultIndex={selectedIndex}
                  canvasMode={canvasMode}
                  setCanvasMode={setCanvasMode}
                  overrides={overrides[selectedIndex] ?? {}}
                  highlightedColumns={highlightedColumns}
                  columnsTruncated={columnsTruncated}
                  onOverride={(specId, spec) => {
                    setOverrides(prev => ({
                      ...prev,
                      [selectedIndex]: { ...(prev[selectedIndex] ?? {}), [specId]: spec },
                    }));
                  }}
                  specs={specs}
                />
              )}
            </div>

            {/* Insight rail */}
            {selectedResult && (
              <InsightRail
                result={selectedResult}
                resultIndex={selectedIndex}
                specs={specs}
                profiles={profiles}
                cache={insightCache}
                onCache={(key, value) => setInsightCache(prev => ({ ...prev, [key]: value }))}
                onHighlight={handleHighlight}
              />
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div
          style={{
            height: 28,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--builder-border)',
            padding: '0 16px',
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--builder-text-label)',
          }}
        >
          <span style={{ opacity: 0.6 }}>INSPECTOR DATA STUDIO · V5</span>
          <span style={{ opacity: 0.6 }}>
            {selectedResult?.rowCount === 47 ? 'THE GAME IS 47-0.' : 'POWERED BY ALOFT'}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── StudioMainCanvas ──────────────────────────────────────────────────────────
// Inline sub-component for the main canvas (table + mode tabs).
// Extracted here rather than a separate file since it's tightly coupled to DataStudio state.

const NUMERIC_TYPES = new Set(['LONG', 'INT', 'INTEGER', 'DECIMAL', 'DOUBLE', 'FLOAT', 'SHORT', 'BYTE']);

function StudioMainCanvas({
  result,
  resultIndex,
  canvasMode,
  setCanvasMode,
  overrides,
  onOverride,
  highlightedColumns,
  columnsTruncated,
  specs,
}: {
  result: QueryResult;
  resultIndex: number;
  canvasMode: 'table' | 'dashboard';
  setCanvasMode: (m: 'table' | 'dashboard') => void;
  overrides: Record<string, ChartSpec>;
  onOverride: (specId: string, spec: ChartSpec) => void;
  highlightedColumns: string[];
  columnsTruncated: boolean;
  specs: ChartSpec[];
}) {
  const isZeroRows = result.rows.length === 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Canvas header — mode tabs */}
      <div
        style={{
          height: 40,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          borderBottom: '1px solid var(--builder-border)',
          padding: '0 16px',
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}
      >
        {/* TABLE tab */}
        <button
          onClick={() => setCanvasMode('table')}
          style={{
            background: canvasMode === 'table' ? 'rgba(253,181,21,0.1)' : 'transparent',
            border: canvasMode === 'table' ? '1px solid rgba(253,181,21,0.3)' : '1px solid transparent',
            color: canvasMode === 'table' ? 'var(--builder-gold)' : 'var(--builder-text-label)',
            borderRadius: 4,
            padding: '3px 10px',
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          TABLE
        </button>

        {/* DASHBOARD tab — enabled in V3 */}
        <button
          onClick={() => setCanvasMode('dashboard')}
          style={{
            background: canvasMode === 'dashboard' ? 'rgba(253,181,21,0.1)' : 'transparent',
            border: canvasMode === 'dashboard' ? '1px solid rgba(253,181,21,0.3)' : '1px solid transparent',
            color: canvasMode === 'dashboard' ? 'var(--builder-gold)' : 'var(--builder-text-label)',
            borderRadius: 4,
            padding: '3px 10px',
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          DASHBOARD
        </button>

        {/* Column-cap warning badge (500-column results) */}
        {columnsTruncated && (
          <span
            style={{
              marginLeft: 8,
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: 9,
              letterSpacing: '0.06em',
              color: 'var(--builder-gold)',
              background: 'rgba(253,181,21,0.08)',
              border: '1px solid rgba(253,181,21,0.2)',
              borderRadius: 3,
              padding: '2px 6px',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            SHOWING 50 OF {result.columns.length} COLUMNS · PROFILING TRUNCATED
          </span>
        )}
      </div>

      {/* Truncation banner */}
      {result.truncated && (
        <div
          style={{
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: 11,
            color: 'var(--builder-text-label)',
            background: 'var(--builder-surface)',
            borderBottom: '1px solid var(--builder-border)',
            padding: '6px 16px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          TRUNCATED · SHOWING FIRST {result.rows.length.toLocaleString()} OF {result.rowCount.toLocaleString()} ROWS
        </div>
      )}

      {/* Content area: zero-row guard, then table or dashboard */}
      {canvasMode === 'dashboard' && isZeroRows ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--builder-surface)',
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--builder-text-label)',
            }}
          >
            NO DATA · 0 ROWS
          </span>
        </div>
      ) : canvasMode === 'dashboard' ? (
        <DashboardGrid
          result={result}
          resultIndex={resultIndex}
          overrides={overrides}
          onOverride={onOverride}
          highlightedColumns={highlightedColumns}
          specs={specs}
        />
      ) : (
        <StudioDataTable result={result} />
      )}

      {/* Canvas footer */}
      <div
        style={{
          height: 32,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          borderTop: '1px solid var(--builder-border)',
          padding: '0 16px',
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 10,
          color: 'var(--builder-text-label)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          gap: 8,
        }}
      >
        {result.truncated ? (
          <span>
            FIRST {result.rows.length.toLocaleString()} OF {result.rowCount.toLocaleString()} ROWS
            <span style={{ color: '#f87171', marginLeft: 8 }}>· TRUNCATED</span>
          </span>
        ) : (
          <span>{result.rowCount.toLocaleString()} ROWS · {result.columns.length} COLUMNS</span>
        )}
      </div>
    </div>
  );
}

// ── StudioDataTable ───────────────────────────────────────────────────────────

function StudioDataTable({ result }: { result: QueryResult }) {
  const { columns, rows } = result;
  const [useVirt, setUseVirt] = useState(false);
  const [VirtualizerModule, setVirtualizerModule] = useState<{
    useVirtualizer: typeof import('@tanstack/react-virtual').useVirtualizer
  } | null>(null);

  // Lazy-load virtualizer only when row count exceeds 200
  useEffect(() => {
    if (rows.length > 200) {
      setUseVirt(true);
      import('@tanstack/react-virtual').then(mod => {
        setVirtualizerModule({ useVirtualizer: mod.useVirtualizer });
      });
    }
  }, [rows.length]);

  if (useVirt && VirtualizerModule) {
    return (
      <VirtualTable
        columns={columns}
        rows={rows}
        useVirtualizer={VirtualizerModule.useVirtualizer}
      />
    );
  }

  return (
    <div
      style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 11,
        }}
      >
        <thead
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: 'var(--builder-surface)',
            borderBottom: '1px solid var(--builder-border)',
          }}
        >
          <tr>
            {columns.map(col => {
              const isNum = NUMERIC_TYPES.has(col.type_name);
              return (
                <th
                  key={col.name}
                  style={{
                    padding: '8px 12px',
                    textAlign: isNum ? 'right' : 'left',
                    fontWeight: 500,
                    color: 'var(--builder-text)',
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--builder-border)',
                  }}
                >
                  <span style={{ color: 'var(--builder-text)', fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}>
                    {col.name}
                  </span>
                  {' '}
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontSize: 9,
                      color: 'var(--builder-text-label)',
                      border: '1px solid var(--builder-border)',
                      borderRadius: 2,
                      padding: '1px 4px',
                      marginLeft: 4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {col.type_name}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              style={{
                background: ri % 2 === 0 ? 'transparent' : 'rgba(15,34,54,0.3)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--builder-surface-raised)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ri % 2 === 0 ? 'transparent' : 'rgba(15,34,54,0.3)'; }}
            >
              {columns.map(col => {
                const isNum = NUMERIC_TYPES.has(col.type_name);
                const raw = row[col.name];
                const val = raw == null ? '' : String(raw);
                const display = val.length > 40 ? val.slice(0, 40) + '…' : val;
                return (
                  <td
                    key={col.name}
                    title={val.length > 40 ? val : undefined}
                    style={{
                      padding: '5px 12px',
                      textAlign: isNum ? 'right' : 'left',
                      color: 'var(--builder-text-muted)',
                      fontSize: 11,
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      borderRight: '1px solid rgba(30,58,82,0.4)',
                      whiteSpace: 'nowrap',
                      maxWidth: 240,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── VirtualTable ─────────────────────────────────────────────────────────────
// Rendered only when rows > 200 and the virtualizer module has loaded.

const ROW_HEIGHT = 33;

function VirtualTable({
  columns,
  rows,
  useVirtualizer,
}: {
  columns: QueryResult['columns'];
  rows: QueryResult['rows'];
  useVirtualizer: typeof import('@tanstack/react-virtual').useVirtualizer;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const items = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          fontSize: 11,
        }}
      >
        <thead
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: 'var(--builder-surface)',
            borderBottom: '1px solid var(--builder-border)',
          }}
        >
          <tr>
            {columns.map(col => {
              const isNum = NUMERIC_TYPES.has(col.type_name);
              return (
                <th
                  key={col.name}
                  style={{
                    padding: '8px 12px',
                    textAlign: isNum ? 'right' : 'left',
                    fontWeight: 500,
                    color: 'var(--builder-text)',
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--builder-border)',
                  }}
                >
                  <span style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}>{col.name}</span>
                  {' '}
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontSize: 9,
                      color: 'var(--builder-text-label)',
                      border: '1px solid var(--builder-border)',
                      borderRadius: 2,
                      padding: '1px 4px',
                      marginLeft: 4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {col.type_name}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Spacer before virtual items */}
          {items.length > 0 && items[0].start > 0 && (
            <tr style={{ height: items[0].start }} />
          )}
          {items.map(vRow => {
            const row = rows[vRow.index];
            const ri = vRow.index;
            return (
              <tr
                key={vRow.key}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                style={{
                  background: ri % 2 === 0 ? 'transparent' : 'rgba(15,34,54,0.3)',
                  height: ROW_HEIGHT,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--builder-surface-raised)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ri % 2 === 0 ? 'transparent' : 'rgba(15,34,54,0.3)'; }}
              >
                {columns.map(col => {
                  const isNum = NUMERIC_TYPES.has(col.type_name);
                  const raw = row[col.name];
                  const val = raw == null ? '' : String(raw);
                  const display = val.length > 40 ? val.slice(0, 40) + '…' : val;
                  return (
                    <td
                      key={col.name}
                      title={val.length > 40 ? val : undefined}
                      style={{
                        padding: '5px 12px',
                        textAlign: isNum ? 'right' : 'left',
                        color: 'var(--builder-text-muted)',
                        fontSize: 11,
                        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                        borderRight: '1px solid rgba(30,58,82,0.4)',
                        whiteSpace: 'nowrap',
                        maxWidth: 240,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {/* Spacer after virtual items */}
          {items.length > 0 && (
            <tr style={{ height: totalHeight - (items[items.length - 1].end ?? 0) }} />
          )}
        </tbody>
      </table>
    </div>
  );
}
