'use client';

import React from 'react';
import { Trash2, Plus, ExternalLink, Info } from 'lucide-react';
import type { WidgetSpec } from '@/lib/dashboards/types';
import { isRawSqlWidget } from '@/lib/dashboards/types';
import { RawSqlBadge } from '@/components/inspector/RawSqlBadge';
import type { ChartSpec } from '@/lib/studio/types';
import type { SemanticFilter, FilterOp } from '@/lib/semantic/types';
import {
  recommendedKindToWidgetKind,
  type ChartRecommendation,
} from '@/lib/dashboards/chart-defaults';
import { useBuilderStore } from './builder-store';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'in', label: 'in' },
  { value: 'not_in', label: 'not in' },
  { value: 'between', label: 'between' },
  { value: 'is_null', label: 'is null' },
  { value: 'is_not_null', label: 'is not null' },
];

const CHART_KINDS: ChartSpec['kind'][] = ['bar', 'line', 'kpi', 'donut', 'scatter', 'heatmap', 'histogram'];

interface WidgetConfigPanelProps {
  widget: WidgetSpec;
  definitions: Map<string, { label: string; status: string }>;
  readOnly?: boolean;
  /** Smart-defaults recommendation for the current field shape (Phase 3A). */
  recommendation?: ChartRecommendation | null;
  /**
   * Called when the user picks a chart kind by hand. When provided it replaces
   * the store update so the parent can record the manual override (and stop
   * auto-recommending). Falls back to the store update when omitted.
   */
  onChartKindChange?: (kind: ChartSpec['kind']) => void;
}

export function WidgetConfigPanel({ widget, definitions, readOnly, recommendation, onChartKindChange }: WidgetConfigPanelProps) {
  const updateWidget = useBuilderStore((s) => s.updateWidget);
  const updateWidgetSemanticQuery = useBuilderStore((s) => s.updateWidgetSemanticQuery);
  const removeWidget = useBuilderStore((s) => s.removeWidget);
  const driftMap = useBuilderStore((s) => s.driftMap);
  const drift = driftMap[widget.widgetId];

  const handleTitleChange = (title: string) => {
    updateWidget(widget.widgetId, { title });
  };

  // ── Phase 3.5C: raw-SQL widgets aren't semantically editable ────────────────
  // They have no dimensions/measures/filters to configure — show a compact,
  // read-only info panel (title + badge + frozen SQL) and the remove action.
  if (isRawSqlWidget(widget)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, overflowY: 'auto', height: '100%', position: 'relative' }}>
        {readOnly && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'default' }} title="View only — you cannot edit this dashboard" />
        )}
        <Section label="TITLE">
          <input
            type="text"
            value={widget.title}
            onChange={(e) => !readOnly && handleTitleChange(e.target.value)}
            readOnly={readOnly}
            style={{
              ...MONO, fontSize: 11, background: 'var(--builder-surface)', border: '1px solid var(--builder-border)',
              borderRadius: 4, padding: '6px 8px', color: readOnly ? 'var(--builder-text-muted)' : 'var(--builder-text)',
              width: '100%', outline: 'none', cursor: readOnly ? 'default' : undefined,
            }}
            placeholder="Widget title"
          />
        </Section>
        <Section label="GOVERNANCE">
          <RawSqlBadge />
          <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', lineHeight: 1.5, marginTop: 6, display: 'block' }}>
            This widget runs frozen raw SQL — it is not governed and not drift-checked.
            Graduate it to a metric in the Inspector to bring it under governance.
          </span>
        </Section>
        <Section label="SQL">
          <pre
            style={{
              ...MONO, fontSize: 9, color: 'var(--builder-text)', background: 'var(--builder-surface)',
              border: '1px solid var(--builder-border)', borderRadius: 4, padding: '8px', margin: 0,
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220,
            }}
          >
            {widget.rawSql}
          </pre>
        </Section>
        {widget.chartConfig.x && (
          <Section label="AXES">
            <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)' }}>
              X: {widget.chartConfig.x} · Y: {(widget.chartConfig.y ?? []).join(', ') || '—'}
            </span>
          </Section>
        )}
        {!readOnly && (
          <div style={{ marginTop: 'auto', paddingTop: 12 }}>
            <button
              onClick={() => removeWidget(widget.widgetId)}
              style={{
                ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 4,
                border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)',
                color: '#F87171', cursor: 'pointer', width: '100%', justifyContent: 'center',
              }}
            >
              <Trash2 size={12} />
              REMOVE WIDGET
            </button>
          </div>
        )}
      </div>
    );
  }

  const handleChartKindChange = (chartKind: ChartSpec['kind']) => {
    if (readOnly) return;
    if (onChartKindChange) onChartKindChange(chartKind);
    else updateWidget(widget.widgetId, { chartKind });
  };

  // Alternative widget kinds from the recommendation, mapped to the widget kind
  // subset and de-duplicated against the current kind.
  const alternativeKinds = Array.from(
    new Set((recommendation?.alternatives ?? []).map(recommendedKindToWidgetKind)),
  ).filter((k) => k !== widget.chartKind);

  const handleRemoveDimension = (dimId: string) => {
    const sq = { ...widget.semanticQuery };
    sq.dimensions = sq.dimensions.filter((d) => d.dimensionId !== dimId);
    updateWidgetSemanticQuery(widget.widgetId, sq);
  };

  const handleRemoveMeasure = (measId: string) => {
    const sq = { ...widget.semanticQuery };
    sq.measures = sq.measures.filter((m) => m.measureId !== measId);
    updateWidgetSemanticQuery(widget.widgetId, sq);
  };

  const DEFAULT_STALE_SEC = 300;

  const handleFreshnessMode = (mode: 'live' | 'cached') => {
    if (readOnly) return;
    if (mode === 'live') {
      // Absence == 'live' — keep the stored spec clean.
      updateWidget(widget.widgetId, { freshness: undefined });
    } else {
      updateWidget(widget.widgetId, {
        freshness: {
          mode: 'cached',
          staleAfterSec: widget.freshness?.staleAfterSec ?? DEFAULT_STALE_SEC,
        },
      });
    }
  };

  const handleStaleSecChange = (seconds: number) => {
    if (readOnly) return;
    updateWidget(widget.widgetId, {
      freshness: { mode: 'cached', staleAfterSec: Math.max(1, Math.round(seconds)) },
    });
  };

  const handleConfigChange = (field: 'x' | 'series' | 'value', value: string) => {
    updateWidget(widget.widgetId, {
      chartConfig: { ...widget.chartConfig, [field]: value || undefined },
    });
  };

  const handleYChange = (values: string[]) => {
    updateWidget(widget.widgetId, {
      chartConfig: { ...widget.chartConfig, y: values.length > 0 ? values : undefined },
    });
  };

  const handleAddFilter = () => {
    const sq = { ...widget.semanticQuery };
    const allFields = buildFilterFieldList(widget, definitions);
    if (allFields.length === 0) return;
    const first = allFields[0];
    const newFilter: SemanticFilter = {
      fieldId: first.id,
      fieldKind: first.kind,
      op: 'eq',
      value: '',
    };
    sq.filters = [...sq.filters, newFilter];
    updateWidgetSemanticQuery(widget.widgetId, sq);
  };

  const handleUpdateFilter = (index: number, updated: SemanticFilter) => {
    const sq = { ...widget.semanticQuery };
    sq.filters = sq.filters.map((f, i) => (i === index ? updated : f));
    updateWidgetSemanticQuery(widget.widgetId, sq);
  };

  const handleRemoveFilter = (index: number) => {
    const sq = { ...widget.semanticQuery };
    sq.filters = sq.filters.filter((_, i) => i !== index);
    updateWidgetSemanticQuery(widget.widgetId, sq);
  };

  // Available column names from assigned dims/measures
  const dimLabels = widget.semanticQuery.dimensions.map((d) => {
    const def = definitions.get(d.dimensionId);
    return { id: d.dimensionId, label: def?.label ?? d.dimensionId.slice(-8) };
  });
  const measureLabels = widget.semanticQuery.measures.map((m) => {
    const def = definitions.get(m.measureId);
    return { id: m.measureId, label: def?.label ?? m.measureId.slice(-8) };
  });
  const allFields = [...dimLabels, ...measureLabels];

  const filterFields = buildFilterFieldList(widget, definitions);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, overflowY: 'auto', height: '100%', position: 'relative' }}>
      {readOnly && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'default' }} title="View only — you cannot edit this dashboard" />
      )}
      {/* Title */}
      <Section label="TITLE">
        <input
          type="text"
          value={widget.title}
          onChange={(e) => !readOnly && handleTitleChange(e.target.value)}
          readOnly={readOnly}
          style={{
            ...MONO,
            fontSize: 11,
            background: 'var(--builder-surface)',
            border: '1px solid var(--builder-border)',
            borderRadius: 4,
            padding: '6px 8px',
            color: readOnly ? 'var(--builder-text-muted)' : 'var(--builder-text)',
            width: '100%',
            outline: 'none',
            cursor: readOnly ? 'default' : undefined,
          }}
          placeholder="Widget title"
        />
      </Section>

      {/* Chart Kind */}
      <Section label="CHART KIND">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {CHART_KINDS.map((kind) => (
            <button
              key={kind}
              onClick={() => handleChartKindChange(kind)}
              style={{
                ...MONO,
                fontSize: 9,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '4px 8px',
                borderRadius: 3,
                border: `1px solid ${widget.chartKind === kind ? '#FDB515' : 'var(--builder-border)'}`,
                background: widget.chartKind === kind ? 'rgba(253,181,21,0.1)' : 'transparent',
                color: widget.chartKind === kind ? '#FDB515' : 'var(--builder-text-muted)',
                cursor: 'pointer',
              }}
            >
              {kind}
            </button>
          ))}
        </div>

        {/* "Why this chart" — smart-defaults rationale + one-click alternatives */}
        {recommendation && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
              <Info size={11} style={{ color: 'var(--builder-text-muted)', flexShrink: 0, marginTop: 1 }} />
              <span style={{ ...MONO, fontSize: 9, lineHeight: 1.4, color: 'var(--builder-text-muted)' }}>
                {recommendation.rationale}
              </span>
            </div>
            {!readOnly && alternativeKinds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)' }}>Try:</span>
                {alternativeKinds.map((kind) => (
                  <button
                    key={kind}
                    onClick={() => handleChartKindChange(kind)}
                    style={{
                      ...MONO, fontSize: 9, letterSpacing: '0.04em', textTransform: 'uppercase',
                      padding: '2px 7px', borderRadius: 3, border: '1px dashed var(--builder-border)',
                      background: 'transparent', color: 'var(--builder-text)', cursor: 'pointer',
                    }}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Assigned Dimensions */}
      <Section label="DIMENSIONS">
        {dimLabels.length === 0 ? (
          <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)' }}>
            Click a dimension in the picker to assign it
          </span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {dimLabels.map((d) => (
              <FieldChip key={d.id} label={d.label} onRemove={() => handleRemoveDimension(d.id)} />
            ))}
          </div>
        )}
      </Section>

      {/* Assigned Measures */}
      <Section label="MEASURES">
        {measureLabels.length === 0 ? (
          <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)' }}>
            Click a measure in the picker to assign it
          </span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {measureLabels.map((m) => (
              <FieldChip key={m.id} label={m.label} onRemove={() => handleRemoveMeasure(m.id)} />
            ))}
          </div>
        )}
      </Section>

      {/* Axis Mapping */}
      {allFields.length > 0 && (
        <Section label="AXIS MAPPING">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <AxisSelect
              label="X Axis"
              value={widget.chartConfig.x ?? ''}
              options={allFields}
              onChange={(v) => handleConfigChange('x', v)}
            />
            <AxisMultiSelect
              label="Y Axis"
              values={widget.chartConfig.y ?? []}
              options={allFields}
              onChange={handleYChange}
            />
            <AxisSelect
              label="Series"
              value={widget.chartConfig.series ?? ''}
              options={allFields}
              onChange={(v) => handleConfigChange('series', v)}
            />
          </div>
        </Section>
      )}

      {/* Filters */}
      {filterFields.length > 0 && (
        <Section label="FILTERS">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {widget.semanticQuery.filters.map((filter, idx) => (
              <FilterRow
                key={idx}
                filter={filter}
                availableFields={filterFields}
                onChange={(updated) => handleUpdateFilter(idx, updated)}
                onRemove={() => handleRemoveFilter(idx)}
              />
            ))}
            <button
              onClick={handleAddFilter}
              style={{
                ...MONO,
                fontSize: 9,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 3,
                border: '1px solid var(--builder-border)',
                background: 'transparent',
                color: 'var(--builder-text-muted)',
                cursor: 'pointer',
              }}
            >
              <Plus size={10} />
              ADD FILTER
            </button>
          </div>
        </Section>
      )}

      {/* Data freshness (Phase 2) */}
      <Section label="DATA FRESHNESS">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['live', 'cached'] as const).map((mode) => {
            const active = (widget.freshness?.mode ?? 'live') === mode;
            return (
              <button
                key={mode}
                onClick={() => handleFreshnessMode(mode)}
                style={{
                  ...MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
                  flex: 1, padding: '4px 8px', borderRadius: 3,
                  border: `1px solid ${active ? '#FDB515' : 'var(--builder-border)'}`,
                  background: active ? 'rgba(253,181,21,0.1)' : 'transparent',
                  color: active ? '#FDB515' : 'var(--builder-text-muted)',
                  cursor: readOnly ? 'default' : 'pointer',
                }}
              >
                {mode}
              </button>
            );
          })}
        </div>
        {widget.freshness?.mode === 'cached' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', whiteSpace: 'nowrap' }}>
              Refresh every
            </span>
            <input
              type="number"
              min={1}
              value={widget.freshness.staleAfterSec ?? DEFAULT_STALE_SEC}
              onChange={(e) => handleStaleSecChange(Number(e.target.value))}
              readOnly={readOnly}
              style={{
                ...MONO, fontSize: 10, width: 70,
                background: 'var(--builder-surface)', border: '1px solid var(--builder-border)',
                borderRadius: 3, padding: '3px 6px', color: 'var(--builder-text)', outline: 'none',
              }}
            />
            <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)' }}>sec</span>
          </div>
        )}
      </Section>

      {/* Provenance — link back to the source chart in the Inspector (Phase 2) */}
      {widget.source_chart_id && (
        <Section label="SOURCE">
          <a
            href={`/inspector?sourceChart=${encodeURIComponent(widget.source_chart_id)}`}
            style={{
              ...MONO, fontSize: 9, letterSpacing: '0.04em', color: '#FDB515',
              textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <ExternalLink size={11} />
            Open source chart in Inspector
          </a>
        </Section>
      )}

      {/* Drift / Unavailable status */}
      {drift && drift.status !== 'ok' && (
        <Section label="STATUS">
          {drift.status === 'unavailable' && (
            <div style={{ ...MONO, fontSize: 10, padding: '6px 8px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#F87171' }}>
              <strong>Definition unavailable</strong>
              <div style={{ fontSize: 9, marginTop: 4, color: 'rgba(248,113,113,0.8)' }}>
                {drift.unavailableIds && drift.unavailableIds.length > 0
                  ? `${drift.unavailableIds.length} referenced ID(s) have been archived or deleted. Remove them or replace with active definitions.`
                  : 'One or more referenced definitions no longer exist.'}
              </div>
            </div>
          )}
          {drift.status === 'changed' && (
            <div style={{ ...MONO, fontSize: 10, padding: '6px 8px', borderRadius: 3, background: 'rgba(253,181,21,0.08)', border: '1px solid rgba(253,181,21,0.2)', color: '#FDB515' }}>
              <strong>Definition changed</strong>
              <div style={{ fontSize: 9, marginTop: 4, color: 'rgba(253,181,21,0.8)' }}>
                {drift.changedMeasures && drift.changedMeasures.length > 0
                  ? `${drift.changedMeasures.length} measure(s) have been modified (aggregate, expression, or metric type) since this dashboard was last saved. Re-save to accept the current computation.`
                  : 'Measure computation has changed since last save.'}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Delete widget */}
      <div style={{ marginTop: 'auto', paddingTop: 12 }}>
        <button
          onClick={() => removeWidget(widget.widgetId)}
          style={{
            ...MONO,
            fontSize: 10,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 4,
            border: '1px solid rgba(239,68,68,0.3)',
            background: 'rgba(239,68,68,0.06)',
            color: '#F87171',
            cursor: 'pointer',
            width: '100%',
            justifyContent: 'center',
          }}
        >
          <Trash2 size={12} />
          REMOVE WIDGET
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--builder-text-label)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function FieldChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div
      style={{
        ...MONO,
        fontSize: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 3,
        border: '1px solid var(--builder-border)',
        background: 'var(--builder-surface)',
        color: 'var(--builder-text)',
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <button
        onClick={onRemove}
        style={{ background: 'transparent', border: 'none', color: 'var(--builder-text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

function AxisSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', width: 50, flexShrink: 0 }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...MONO,
          fontSize: 10,
          background: 'var(--builder-surface)',
          border: '1px solid var(--builder-border)',
          borderRadius: 3,
          padding: '3px 6px',
          color: 'var(--builder-text)',
          flex: 1,
        }}
      >
        <option value="">— none —</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.label}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function AxisMultiSelect({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: { id: string; label: string }[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (optLabel: string) => {
    if (values.includes(optLabel)) {
      onChange(values.filter((v) => v !== optLabel));
    } else {
      onChange([...values, optLabel]);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', width: 50, flexShrink: 0, paddingTop: 4 }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, flex: 1 }}>
        {options.map((opt) => {
          const active = values.includes(opt.label);
          return (
            <button
              key={opt.id}
              onClick={() => toggle(opt.label)}
              style={{
                ...MONO,
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 2,
                border: `1px solid ${active ? '#FDB515' : 'var(--builder-border)'}`,
                background: active ? 'rgba(253,181,21,0.1)' : 'transparent',
                color: active ? '#FDB515' : 'var(--builder-text-muted)',
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function buildFilterFieldList(
  widget: WidgetSpec,
  definitions: Map<string, { label: string; status: string }>,
): { id: string; label: string; kind: 'dimension' | 'measure' }[] {
  if (isRawSqlWidget(widget)) return [];
  const fields: { id: string; label: string; kind: 'dimension' | 'measure' }[] = [];
  for (const d of widget.semanticQuery.dimensions) {
    const def = definitions.get(d.dimensionId);
    fields.push({ id: d.dimensionId, label: def?.label ?? d.dimensionId.slice(-8), kind: 'dimension' });
  }
  for (const m of widget.semanticQuery.measures) {
    const def = definitions.get(m.measureId);
    fields.push({ id: m.measureId, label: def?.label ?? m.measureId.slice(-8), kind: 'measure' });
  }
  return fields;
}

const NULLARY_OPS: FilterOp[] = ['is_null', 'is_not_null'];
const ARRAY_OPS: FilterOp[] = ['in', 'not_in'];
const RANGE_OPS: FilterOp[] = ['between'];

function FilterRow({
  filter,
  availableFields,
  onChange,
  onRemove,
}: {
  filter: SemanticFilter;
  availableFields: { id: string; label: string; kind: 'dimension' | 'measure' }[];
  onChange: (updated: SemanticFilter) => void;
  onRemove: () => void;
}) {
  const handleFieldChange = (fieldId: string) => {
    const field = availableFields.find((f) => f.id === fieldId);
    if (!field) return;
    onChange({ ...filter, fieldId, fieldKind: field.kind });
  };

  const handleOpChange = (op: FilterOp) => {
    let value: unknown = filter.value;
    if (NULLARY_OPS.includes(op)) value = null;
    else if (ARRAY_OPS.includes(op) && !Array.isArray(value)) value = [];
    else if (RANGE_OPS.includes(op) && !Array.isArray(value)) value = ['', ''];
    else if (!NULLARY_OPS.includes(op) && !ARRAY_OPS.includes(op) && !RANGE_OPS.includes(op) && Array.isArray(value)) value = '';
    onChange({ ...filter, op, value });
  };

  const handleValueChange = (value: unknown) => {
    onChange({ ...filter, value });
  };

  const isNullary = NULLARY_OPS.includes(filter.op);
  const isArray = ARRAY_OPS.includes(filter.op);
  const isRange = RANGE_OPS.includes(filter.op);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 0', borderBottom: '1px solid var(--builder-border)' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <select
          value={filter.fieldId}
          onChange={(e) => handleFieldChange(e.target.value)}
          style={{
            ...MONO, fontSize: 9, flex: 1, background: 'var(--builder-surface)',
            border: '1px solid var(--builder-border)', borderRadius: 3, padding: '3px 4px', color: 'var(--builder-text)',
          }}
        >
          {availableFields.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <select
          value={filter.op}
          onChange={(e) => handleOpChange(e.target.value as FilterOp)}
          style={{
            ...MONO, fontSize: 9, width: 60, background: 'var(--builder-surface)',
            border: '1px solid var(--builder-border)', borderRadius: 3, padding: '3px 4px', color: 'var(--builder-text)',
          }}
        >
          {FILTER_OPS.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
        <button
          onClick={onRemove}
          style={{ background: 'transparent', border: 'none', color: 'var(--builder-text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}
        >
          <Trash2 size={10} />
        </button>
      </div>
      {!isNullary && (
        <div style={{ paddingLeft: 4 }}>
          {isRange ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="text"
                value={Array.isArray(filter.value) ? String(filter.value[0] ?? '') : ''}
                onChange={(e) => {
                  const arr = Array.isArray(filter.value) ? [...filter.value] : ['', ''];
                  arr[0] = e.target.value;
                  handleValueChange(arr);
                }}
                placeholder="from"
                style={{ ...MONO, fontSize: 9, flex: 1, background: 'var(--builder-surface)', border: '1px solid var(--builder-border)', borderRadius: 3, padding: '3px 4px', color: 'var(--builder-text)' }}
              />
              <span style={{ ...MONO, fontSize: 8, color: 'var(--builder-text-muted)' }}>—</span>
              <input
                type="text"
                value={Array.isArray(filter.value) ? String(filter.value[1] ?? '') : ''}
                onChange={(e) => {
                  const arr = Array.isArray(filter.value) ? [...filter.value] : ['', ''];
                  arr[1] = e.target.value;
                  handleValueChange(arr);
                }}
                placeholder="to"
                style={{ ...MONO, fontSize: 9, flex: 1, background: 'var(--builder-surface)', border: '1px solid var(--builder-border)', borderRadius: 3, padding: '3px 4px', color: 'var(--builder-text)' }}
              />
            </div>
          ) : isArray ? (
            <input
              type="text"
              value={Array.isArray(filter.value) ? filter.value.join(', ') : ''}
              onChange={(e) => {
                const items = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                handleValueChange(items);
              }}
              placeholder="comma-separated values"
              style={{ ...MONO, fontSize: 9, width: '100%', background: 'var(--builder-surface)', border: '1px solid var(--builder-border)', borderRadius: 3, padding: '3px 4px', color: 'var(--builder-text)' }}
            />
          ) : (
            <input
              type="text"
              value={filter.value != null ? String(filter.value) : ''}
              onChange={(e) => handleValueChange(e.target.value)}
              placeholder="value"
              style={{ ...MONO, fontSize: 9, width: '100%', background: 'var(--builder-surface)', border: '1px solid var(--builder-border)', borderRadius: 3, padding: '3px 4px', color: 'var(--builder-text)' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
