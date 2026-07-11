'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeftRight, Settings2 } from 'lucide-react';
import type { QueryResult } from '@/hooks/useInspectorChat';
import type { ChartSpec } from '@/lib/studio/types';
import StudioChart from './StudioChart';

// ── Surface tokens (direct hex — consistent with spec) ────────────────────────
const T = {
  surface:  'var(--builder-surface)',
  raised:   'var(--builder-surface-raised)',
  border:   'var(--builder-border)',
  borderBr: 'var(--builder-border-bright)',
  gold:     'var(--builder-gold)',
  text:     'var(--builder-text)',
  muted:    'var(--builder-text-muted)',
  label:    'var(--builder-text-label)',
} as const;

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ spec }: { spec: ChartSpec }) {
  const label = spec.rationale
    ? spec.rationale.replace(/^[^:]+:\s*/, '').toUpperCase()
    : 'TOTAL';

  return (
    <div
      style={{
        background: T.raised,
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        padding: '16px 20px',
        minWidth: 160,
        flex: '1 1 160px',
        maxWidth: 280,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span
        style={{
          ...MONO,
          fontSize: 32,
          fontWeight: 700,
          color: T.text,
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        {spec.title}
      </span>
      <span
        style={{
          ...MONO,
          fontSize: 10,
          color: T.label,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Column chip ────────────────────────────────────────────────────────────────
function ColChip({ col }: { col: string }) {
  return (
    <span
      style={{
        ...MONO,
        fontSize: 10,
        border: `1px solid ${T.border}`,
        borderRadius: 3,
        padding: '1px 5px',
        color: T.label,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {col}
    </span>
  );
}

// ── Swap popover ──────────────────────────────────────────────────────────────
function SwapMenu({
  spec,
  allSpecs,
  onSwap,
}: {
  spec: ChartSpec;
  allSpecs: ChartSpec[];
  onSwap: (replacement: ChartSpec) => void;
}) {
  const [open, setOpen] = useState(false);
  const alts = allSpecs.filter(s => spec.alternatives.includes(s.id));

  if (alts.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Swap chart type"
        style={{
          background: 'transparent',
          border: `1px solid ${T.border}`,
          borderRadius: 3,
          color: T.label,
          cursor: 'pointer',
          padding: '2px 4px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <ArrowLeftRight size={12} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            background: 'var(--builder-surface)',
            border: `1px solid ${T.borderBr}`,
            borderRadius: 4,
            zIndex: 10,
            minWidth: 140,
            padding: 4,
          }}
        >
          {alts.map(alt => (
            <button
              key={alt.id}
              onClick={() => { onSwap(alt); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                color: T.text,
                cursor: 'pointer',
                padding: '4px 8px',
                ...MONO,
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                borderRadius: 3,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(253,181,21,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {alt.kind.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Gear (axis override) popover ───────────────────────────────────────────────
function GearMenu({
  spec,
  columnNames,
  onOverride,
}: {
  spec: ChartSpec;
  columnNames: string[];
  onOverride: (overrideSpec: ChartSpec) => void;
}) {
  const [open, setOpen] = useState(false);
  const [xCol, setXCol] = useState(spec.x ?? '');
  const [yCol, setYCol] = useState(spec.y?.[0] ?? '');

  const applyOverride = () => {
    const updated: ChartSpec = {
      ...spec,
      x: xCol || undefined,
      y: yCol ? [yCol] : spec.y,
    };
    onOverride(updated);
    setOpen(false);
  };

  const selectStyle: React.CSSProperties = {
    background: 'var(--builder-surface)',
    border: `1px solid ${T.border}`,
    borderRadius: 3,
    color: T.text,
    padding: '3px 6px',
    ...MONO,
    fontSize: 10,
    width: '100%',
    marginTop: 3,
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Axis override"
        style={{
          background: 'transparent',
          border: `1px solid ${T.border}`,
          borderRadius: 3,
          color: T.label,
          cursor: 'pointer',
          padding: '2px 4px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Settings2 size={12} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            background: 'var(--builder-surface)',
            border: `1px solid ${T.borderBr}`,
            borderRadius: 4,
            zIndex: 10,
            minWidth: 180,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {spec.x !== undefined && (
            <div>
              <span style={{ ...MONO, fontSize: 9, color: T.label, letterSpacing: '0.10em', textTransform: 'uppercase' }}>X AXIS</span>
              <select value={xCol} onChange={e => setXCol(e.target.value)} style={selectStyle}>
                <option value="">— none —</option>
                {columnNames.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {spec.y && spec.y.length > 0 && (
            <div>
              <span style={{ ...MONO, fontSize: 9, color: T.label, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Y AXIS</span>
              <select value={yCol} onChange={e => setYCol(e.target.value)} style={selectStyle}>
                <option value="">— none —</option>
                {columnNames.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <button
            onClick={applyOverride}
            style={{
              background: 'rgba(253,181,21,0.1)',
              border: `1px solid rgba(253,181,21,0.3)`,
              borderRadius: 3,
              color: T.gold,
              cursor: 'pointer',
              padding: '4px 8px',
              ...MONO,
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            APPLY
          </button>
        </div>
      )}
    </div>
  );
}

// ── Chart card ────────────────────────────────────────────────────────────────
function ChartCard({
  spec,
  allSpecs,
  columnNames,
  animationDelay,
  prefersReducedMotion,
  isHighlighted,
  onSwap,
  onOverride,
}: {
  spec: ChartSpec;
  allSpecs: ChartSpec[];
  columnNames: string[];
  animationDelay: number;
  prefersReducedMotion: boolean;
  isHighlighted: boolean;
  onSwap: (id: string, replacement: ChartSpec) => void;
  onOverride: (id: string, updated: ChartSpec) => void;
}) {
  const [entered, setEntered] = useState(prefersReducedMotion);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const t = setTimeout(() => setEntered(true), animationDelay);
    return () => clearTimeout(t);
  }, [animationDelay, prefersReducedMotion]);

  // Drive the gold ring pulse when isHighlighted changes to true
  useEffect(() => {
    if (isHighlighted) {
      setPulse(true);
      if (!prefersReducedMotion) {
        const t = setTimeout(() => setPulse(false), 1000);
        return () => clearTimeout(t);
      }
    } else {
      setPulse(false);
    }
  }, [isHighlighted, prefersReducedMotion]);

  // Collect footer chips (de-duped axis column names)
  const chipCols = [...new Set([
    spec.x,
    ...(spec.y ?? []),
    spec.series,
    spec.value,
  ].filter(Boolean) as string[])];
  const maxChips = 3;
  const shownChips = chipCols.slice(0, maxChips);
  const extraCount = chipCols.length - maxChips;

  const rationale = spec.rationale.length > 60
    ? spec.rationale.slice(0, 57) + '…'
    : spec.rationale;

  return (
    <div
      aria-label={`${spec.kind} chart: ${spec.rationale}`}
      style={{
        background: T.raised,
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(8px)',
        transition: prefersReducedMotion
          ? 'none'
          : 'opacity 180ms ease-out, transform 180ms ease-out, box-shadow 300ms ease-out',
        outline: (isHighlighted || pulse) ? '2px solid #FDB515' : 'none',
        outlineOffset: 2,
        boxShadow: (!prefersReducedMotion && pulse)
          ? '0 0 0 3px #FDB515'
          : 'none',
      }}
    >
      {/* Card header */}
      <div
        style={{
          height: 40,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 12px',
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <span
          style={{
            ...MONO,
            fontSize: 10,
            color: T.label,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {spec.kind.toUpperCase()} · {rationale}
        </span>
        <SwapMenu spec={spec} allSpecs={allSpecs} onSwap={r => onSwap(spec.id, r)} />
        <GearMenu spec={spec} columnNames={columnNames} onOverride={u => onOverride(spec.id, u)} />
      </div>

      {/* Chart */}
      <div style={{ height: 280, flexShrink: 0 }}>
        <StudioChart spec={spec} height={280} />
      </div>

      {/* Card footer — column chips */}
      <div
        style={{
          borderTop: `1px solid ${T.border}`,
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexWrap: 'nowrap',
          overflow: 'hidden',
          flexShrink: 0,
          minHeight: 32,
        }}
      >
        {shownChips.map(col => <ColChip key={col} col={col} />)}
        {extraCount > 0 && (
          <span style={{ ...MONO, fontSize: 9, color: T.label, letterSpacing: '0.06em' }}>
            +{extraCount} more
          </span>
        )}
      </div>
    </div>
  );
}

// ── DashboardGrid ─────────────────────────────────────────────────────────────
export interface DashboardGridProps {
  result: QueryResult;
  resultIndex: number;
  overrides: Record<string, ChartSpec>; // keyed by specId
  onOverride: (specId: string, spec: ChartSpec) => void;
  highlightedColumns: string[];
  specs: ChartSpec[]; // pre-computed by DataStudio (lifted to share with InsightRail)
}

export function DashboardGrid({
  result,
  resultIndex: _resultIndex,
  overrides,
  onOverride,
  highlightedColumns,
  specs: baseSpecs = [],
}: DashboardGridProps) {
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      prefersReducedMotion.current = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
    }
  }, []);

  // Apply per-card overrides (baseSpecs now provided by DataStudio via lifted useMemo)
  const displaySpecs = baseSpecs.map(s => overrides[s.id] ?? s);

  const columnNames = result.columns.map(c => c.name);

  const kpis = displaySpecs.filter(s => s.kind === 'kpi');
  const charts = displaySpecs.filter(s => s.kind !== 'kpi');

  // Build a Set for O(1) highlight lookup
  const highlightedSet = new Set(highlightedColumns);

  // A chart card is highlighted if any of its axis columns are in the set
  const isChartHighlighted = (spec: ChartSpec) => {
    if (highlightedSet.size === 0) return false;
    if (spec.x && highlightedSet.has(spec.x)) return true;
    if (spec.y?.some(c => highlightedSet.has(c))) return true;
    if (spec.series && highlightedSet.has(spec.series)) return true;
    if (spec.value && highlightedSet.has(spec.value)) return true;
    return false;
  };

  // KPI row pulses when a highlight fires but no chart card matches
  const anyChartHighlighted = charts.some(isChartHighlighted);
  const kpiPulse = highlightedSet.size > 0 && !anyChartHighlighted;

  const handleSwap = (specId: string, replacement: ChartSpec) => {
    onOverride(specId, replacement);
  };

  const handleOverride = (specId: string, updated: ChartSpec) => {
    onOverride(specId, updated);
  };

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Row 1: KPI stat cards (max 3) */}
      {kpis.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'nowrap',
            overflow: 'hidden',
            outline: kpiPulse ? '2px solid #FDB515' : 'none',
            outlineOffset: 2,
            borderRadius: 6,
            transition: 'outline 300ms ease-out, box-shadow 300ms ease-out',
            boxShadow: kpiPulse ? '0 0 0 3px #FDB515' : 'none',
          }}
        >
          {kpis.slice(0, 3).map((kpi, i) => (
            <KpiCard key={kpi.id + i} spec={kpi} />
          ))}
        </div>
      )}

      {/* Row 2+: chart grid (2 cols, 1 col below ~1100px) */}
      {charts.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 16,
          }}
          className="lg:grid-cols-1"
        >
          {charts.map((spec, i) => (
            <ChartCard
              key={spec.id}
              spec={spec}
              allSpecs={displaySpecs}
              columnNames={columnNames}
              animationDelay={i * 40}
              prefersReducedMotion={prefersReducedMotion.current}
              isHighlighted={isChartHighlighted(spec)}
              onSwap={handleSwap}
              onOverride={handleOverride}
            />
          ))}
        </div>
      )}

      {charts.length === 0 && kpis.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              ...MONO,
              fontSize: 11,
              color: T.label,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
            }}
          >
            NO CHARTS AVAILABLE FOR THIS DATASET
          </span>
        </div>
      )}

      {/* Single-column or otherwise chart-free result with KPIs present */}
      {charts.length === 0 && kpis.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0' }}>
          <span
            style={{
              ...MONO,
              fontSize: 10,
              color: T.label,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              border: `1px solid ${T.border}`,
              borderRadius: 4,
              padding: '4px 10px',
            }}
          >
            INSUFFICIENT COLUMNS FOR CHARTS
          </span>
        </div>
      )}
    </div>
  );
}
