'use client';

import React, { useState, useEffect } from 'react';
import { Search, Layers, BarChart3, Hash, ChevronRight, BarChart2 } from 'lucide-react';
import type { ChartDSLSpec } from '@/lib/studio/chart-dsl';
import type { SemanticQuery } from '@/lib/semantic/types';
import type { MeasureSnapshot } from '@/lib/dashboards/types';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

const GOLD = '#FDB515';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PickerDimension {
  id: string;
  column_name: string;
  dimension_label: string;
  dimension_type: string;
  description: string | null;
  status: string;
}

interface PickerMeasure {
  id: string;
  column_name: string | null;
  measure_label: string;
  aggregate: string;
  expression: string | null;
  metric_type: string;
  description: string | null;
  status: string;
}

interface PickerEntity {
  id: string;
  entity_label: string;
  full_path: string;
  status: string;
  dimensions: PickerDimension[];
  measures: PickerMeasure[];
}

export interface SavedChart {
  id: string;
  name: string;
  description: string | null;
  chart_dsl: ChartDSLSpec;
  semantic_query: SemanticQuery;
  measure_snapshots: MeasureSnapshot[];
  created_at: string;
}

export interface DefinitionPickerProps {
  entities: PickerEntity[];
  loading: boolean;
  modelId: string;
  onAddDimension: (entityId: string, dimension: PickerDimension) => void;
  onAddMeasure: (entityId: string, measure: PickerMeasure) => void;
  onAddChart: (chart: SavedChart) => void;
}

type PickerTab = 'definitions' | 'charts';

// ── Main component ─────────────────────────────────────────────────────────────

export function DefinitionPicker({
  entities,
  loading,
  modelId,
  onAddDimension,
  onAddMeasure,
  onAddChart,
}: DefinitionPickerProps) {
  const [activeTab, setActiveTab] = useState<PickerTab>('definitions');
  const [search, setSearch] = useState('');
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(
    () => new Set(entities.slice(0, 2).map((e) => e.id)),
  );
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [chartsError, setChartsError] = useState<string | null>(null);

  // Fetch saved charts when Charts tab is first activated
  useEffect(() => {
    if (activeTab !== 'charts' || !modelId) return;
    setChartsLoading(true);
    setChartsError(null);
    fetch(`/api/inspector/charts?modelId=${encodeURIComponent(modelId)}`)
      .then((r) => r.ok ? r.json() as Promise<{ charts: SavedChart[] }> : Promise.reject(new Error(`${r.status}`)))
      .then((data) => setSavedCharts(data.charts ?? []))
      .catch((err: unknown) => setChartsError(err instanceof Error ? err.message : 'Failed to load charts'))
      .finally(() => setChartsLoading(false));
  }, [activeTab, modelId]);

  const toggleEntity = (id: string) => {
    setExpandedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filterText = search.toLowerCase().trim();
  const filteredEntities = entities
    .map((entity) => {
      if (!filterText) return entity;
      const dims = entity.dimensions.filter(
        (d) =>
          d.dimension_label.toLowerCase().includes(filterText) ||
          d.column_name.toLowerCase().includes(filterText),
      );
      const measures = entity.measures.filter(
        (m) =>
          m.measure_label.toLowerCase().includes(filterText) ||
          (m.column_name ?? '').toLowerCase().includes(filterText),
      );
      if (dims.length === 0 && measures.length === 0 && !entity.entity_label.toLowerCase().includes(filterText)) {
        return null;
      }
      return { ...entity, dimensions: dims.length || !filterText ? dims : entity.dimensions, measures: measures.length || !filterText ? measures : entity.measures };
    })
    .filter(Boolean) as PickerEntity[];

  if (loading) {
    return (
      <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <span style={{ ...MONO, fontSize: 10, color: 'var(--builder-text-label)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          LOADING DEFINITIONS…
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar — matches Palette.tsx pattern exactly */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 8px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 2, flex: 1, padding: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
          {(['definitions', 'charts'] as PickerTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '4px 0',
                ...MONO,
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                borderRadius: 3,
                cursor: 'pointer',
                border: 'none',
                transition: 'all 0.15s',
                background: activeTab === tab ? 'rgba(255,255,255,0.08)' : 'transparent',
                fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? GOLD : 'var(--builder-text-muted)',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'definitions' ? (
        <>
          {/* Search */}
          <div style={{ padding: '8px 12px', flexShrink: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--builder-surface)',
                border: '1px solid var(--builder-border)',
                borderRadius: 4,
                padding: '6px 8px',
              }}
            >
              <Search size={12} style={{ color: 'var(--builder-text-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter definitions…"
                style={{
                  ...MONO,
                  fontSize: 11,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--builder-text)',
                  width: '100%',
                }}
              />
            </div>
          </div>

          {/* Entity list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
            {filteredEntities.map((entity) => (
              <EntityGroup
                key={entity.id}
                entity={entity}
                expanded={expandedEntities.has(entity.id)}
                onToggle={() => toggleEntity(entity.id)}
                onAddDimension={(dim) => onAddDimension(entity.id, dim)}
                onAddMeasure={(meas) => onAddMeasure(entity.id, meas)}
              />
            ))}
            {filteredEntities.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <span style={{ ...MONO, fontSize: 10, color: 'var(--builder-text-muted)' }}>
                  No matching definitions
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Charts tab */
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {chartsLoading && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <span style={{ ...MONO, fontSize: 10, color: 'var(--builder-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                LOADING CHARTS…
              </span>
            </div>
          )}
          {chartsError && (
            <div style={{ padding: 12 }}>
              <span style={{ ...MONO, fontSize: 10, color: '#F87171' }}>{chartsError}</span>
            </div>
          )}
          {!chartsLoading && !chartsError && savedCharts.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <BarChart2 size={20} style={{ color: 'var(--builder-text-muted)', margin: '0 auto 8px', display: 'block' }} />
              <span style={{ ...MONO, fontSize: 10, color: 'var(--builder-text-muted)' }}>
                No saved charts yet.
              </span>
              <p style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                Use the Inspector to run a semantic query, then click "SAVE TO CHARTS" on the result.
              </p>
            </div>
          )}
          {!chartsLoading && savedCharts.map((chart) => (
            <ChartCard
              key={chart.id}
              chart={chart}
              onClick={() => onAddChart(chart)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ChartCard ──────────────────────────────────────────────────────────────────

function ChartCard({ chart, onClick }: { chart: SavedChart; onClick: () => void }) {
  const measureLabels = (chart.semantic_query.measures ?? [])
    .slice(0, 3)
    .map((m) => m.measureId.slice(-8));

  return (
    <button
      onClick={onClick}
      title={`Assign "${chart.name}" to selected widget`}
      style={{
        ...MONO,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        width: '100%',
        background: 'transparent',
        border: '1px solid var(--builder-border)',
        borderRadius: 4,
        color: 'var(--builder-text)',
        cursor: 'pointer',
        padding: '8px',
        marginBottom: 6,
        textAlign: 'left',
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(253,181,21,0.06)';
        e.currentTarget.style.borderColor = 'rgba(253,181,21,0.35)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'var(--builder-border)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <BarChart3 size={11} style={{ color: GOLD, flexShrink: 0 }} />
        <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chart.name}
        </span>
        <span
          style={{
            fontSize: 8,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '1px 4px',
            borderRadius: 2,
            background: 'rgba(253,181,21,0.1)',
            color: GOLD,
            border: '1px solid rgba(253,181,21,0.2)',
            flexShrink: 0,
          }}
        >
          {chart.chart_dsl.kind}
        </span>
      </div>
      {measureLabels.length > 0 && (
        <div style={{ fontSize: 9, color: 'var(--builder-text-muted)', paddingLeft: 17 }}>
          {measureLabels.join(' · ')}
          {(chart.semantic_query.measures ?? []).length > 3 && ` +${(chart.semantic_query.measures ?? []).length - 3}`}
        </div>
      )}
    </button>
  );
}

// ── EntityGroup ────────────────────────────────────────────────────────────────

function EntityGroup({
  entity,
  expanded,
  onToggle,
  onAddDimension,
  onAddMeasure,
}: {
  entity: PickerEntity;
  expanded: boolean;
  onToggle: () => void;
  onAddDimension: (dim: PickerDimension) => void;
  onAddMeasure: (meas: PickerMeasure) => void;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      {/* Entity header */}
      <button
        onClick={onToggle}
        style={{
          ...MONO,
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          background: 'transparent',
          border: 'none',
          color: 'var(--builder-text)',
          cursor: 'pointer',
          padding: '6px 4px',
          borderRadius: 3,
        }}
      >
        <ChevronRight
          size={10}
          style={{
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms',
            flexShrink: 0,
          }}
        />
        <Layers size={10} style={{ color: 'var(--builder-gold)', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
          {entity.entity_label}
        </span>
        <StatusBadge status={entity.status} />
      </button>

      {expanded && (
        <div style={{ paddingLeft: 16 }}>
          {/* Dimensions */}
          {entity.dimensions.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', letterSpacing: '0.10em', textTransform: 'uppercase', padding: '2px 4px', display: 'block' }}>
                DIMENSIONS
              </span>
              {entity.dimensions.map((dim) => (
                <DefinitionRow
                  key={dim.id}
                  label={dim.dimension_label}
                  sublabel={dim.column_name}
                  status={dim.status}
                  icon={<Hash size={10} style={{ color: 'var(--builder-text-muted)' }} />}
                  onClick={() => onAddDimension(dim)}
                />
              ))}
            </div>
          )}
          {/* Measures */}
          {entity.measures.length > 0 && (
            <div>
              <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', letterSpacing: '0.10em', textTransform: 'uppercase', padding: '2px 4px', display: 'block' }}>
                MEASURES
              </span>
              {entity.measures.map((meas) => (
                <DefinitionRow
                  key={meas.id}
                  label={meas.measure_label}
                  sublabel={`${meas.aggregate}${meas.expression ? ` · ${meas.expression.slice(0, 20)}` : ''}`}
                  status={meas.status}
                  icon={<BarChart3 size={10} style={{ color: 'var(--builder-text-muted)' }} />}
                  onClick={() => onAddMeasure(meas)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DefinitionRow ──────────────────────────────────────────────────────────────

function DefinitionRow({
  label,
  sublabel,
  status,
  icon,
  onClick,
}: {
  label: string;
  sublabel: string;
  status: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const isCandidate = status === 'candidate';
  return (
    <button
      onClick={onClick}
      title={`Add ${label} to selected widget`}
      style={{
        ...MONO,
        fontSize: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        background: 'transparent',
        border: 'none',
        color: isCandidate ? 'var(--builder-text-muted)' : 'var(--builder-text)',
        cursor: 'pointer',
        padding: '4px 4px',
        borderRadius: 3,
        opacity: isCandidate ? 0.7 : 1,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(253,181,21,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ fontSize: 9, color: 'var(--builder-text-label)', flexShrink: 0, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {sublabel}
      </span>
      <StatusBadge status={status} />
    </button>
  );
}

// ── StatusBadge ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isGoverned = status === 'governed';
  return (
    <span
      style={{
        ...MONO,
        fontSize: 8,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '1px 4px',
        borderRadius: 2,
        flexShrink: 0,
        background: isGoverned ? 'rgba(134,239,172,0.1)' : 'rgba(253,181,21,0.1)',
        color: isGoverned ? '#86EFAC' : '#FDB515',
        border: `1px solid ${isGoverned ? 'rgba(134,239,172,0.2)' : 'rgba(253,181,21,0.2)'}`,
      }}
    >
      {isGoverned ? 'GOV' : 'CAND'}
    </span>
  );
}
