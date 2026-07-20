'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Check, Play, Sparkles, AlertTriangle } from 'lucide-react';
import { WidgetPreview } from '../dashboard-builder/WidgetPreview';
import type { DefinitionMap } from '../dashboard-builder/widget-option';
import { TrustPanel } from '../TrustPanel';
import {
  AGGREGATES,
  METRIC_TYPES,
  DIMENSION_TYPES,
  buildDraftPreviewQuery,
} from '@/lib/semantic/authoring-draft';
import { compileSafety } from '@/lib/semantic/compiler';
import type { WidgetSpec } from '@/lib/dashboards/types';

// ── Brand tokens (mirror SemanticGovernancePanel) ────────────────────────────
const GOLD = '#FDB515';
const NAVY = '#003262';
const MUTED = '#8892A4';
const GREEN = '#22c55e';
const RED = '#f43f5e';
const BORDER_SUBTLE = 'rgba(253,181,21,0.15)';
const BORDER_MID = 'rgba(253,181,21,0.25)';
const BORDER_STRONG = 'rgba(253,181,21,0.55)';
const SURFACE = 'rgba(255,255,255,0.03)';
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const sans: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };

// ── authoring-meta shape ──────────────────────────────────────────────────────
interface MetaMeasure { id: string; column_name: string | null; measure_label: string; aggregate: string; metric_type: string; status: string; }
interface MetaDimension { id: string; column_name: string; dimension_label: string; dimension_type: string; status: string; }
interface MetaEntity {
  id: string; entity_label: string; full_path: string; status: string;
  columns: string[]; dimensions: MetaDimension[]; measures: MetaMeasure[];
}

export interface DefineMetricPrefill {
  tableKind?: 'measure' | 'dimension';
  entityId?: string;
  /** A governed/existing measure id whose definition should seed the form. */
  measureId?: string;
  measureLabel?: string;
  nlIntent?: string;
}

export interface DefineMetricEdit {
  tableKind: 'measure' | 'dimension';
  id: string;
  entityId: string;
  measure_label?: string;
  metric_type?: string;
  aggregate?: string | null;
  column_name?: string | null;
  expression?: string | null;
  unit?: string | null;
  format_hint?: string | null;
  dimension_label?: string;
  dimension_type?: string;
  nl_intent?: string | null;
}

interface DefineMetricPanelProps {
  modelId: string;
  onClose: () => void;
  /** Called after a successful save (create or edit) so hosts can refresh. */
  onSaved?: () => void;
  prefill?: DefineMetricPrefill;
  edit?: DefineMetricEdit;
  /** When editing, run the preview automatically once metadata has loaded. */
  autoPreview?: boolean;
}

interface PreviewState {
  rows: Record<string, unknown>[];
  sql: string;
  rowCount: number;
  isDraft: boolean;
  definitionsUsed: { dimensions: string[]; measures: string[] };
  groupById: string | null;
  pairMeasureId: string | null;
}

export function DefineMetricPanel({ modelId, onClose, onSaved, prefill, edit, autoPreview }: DefineMetricPanelProps) {
  const isEdit = !!edit;

  // ── Form state ──────────────────────────────────────────────────────────────
  const [tableKind, setTableKind] = useState<'measure' | 'dimension'>(edit?.tableKind ?? prefill?.tableKind ?? 'measure');
  const [entityId, setEntityId] = useState(edit?.entityId ?? prefill?.entityId ?? '');

  // measure fields
  const [metricType, setMetricType] = useState(edit?.metric_type ?? 'simple');
  const [aggregate, setAggregate] = useState(edit?.aggregate ?? 'sum');
  const [measureLabel, setMeasureLabel] = useState(edit?.measure_label ?? prefill?.measureLabel ?? '');
  const [expression, setExpression] = useState(edit?.expression ?? '');
  const [unit, setUnit] = useState(edit?.unit ?? '');

  // dimension fields
  const [dimensionLabel, setDimensionLabel] = useState(edit?.dimension_label ?? '');
  const [dimensionType, setDimensionType] = useState(edit?.dimension_type ?? 'categorical');

  // shared
  const [columnName, setColumnName] = useState(edit?.column_name ?? '');
  const [formatHint, setFormatHint] = useState(edit?.format_hint ?? '');
  const [nlIntent, setNlIntent] = useState(edit?.nl_intent ?? prefill?.nlIntent ?? '');

  // ── Meta + status ─────────────────────────────────────────────────────────
  const [meta, setMeta] = useState<MetaEntity[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [savedId, setSavedId] = useState<string | null>(edit?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [groupById, setGroupById] = useState<string>('');       // measure preview: optional dim
  const [pairMeasureId, setPairMeasureId] = useState<string>(''); // dimension preview: required measure
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Inline compileSafety on the expression field (measure ratio/derived).
  const exprUnsafe = useMemo(() => {
    if (!expression.trim()) return null;
    const s = compileSafety(expression);
    return s.safe ? null : (s.reason ?? 'expression contains a forbidden keyword');
  }, [expression]);

  // ── Load authoring meta ─────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setMetaLoading(true);
      setMetaError(null);
      try {
        const res = await fetch(`/api/inspector/semantic/${modelId}/authoring-meta`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { entities: MetaEntity[] };
        if (!alive) return;
        setMeta(json.entities ?? []);
        // Default entity if none chosen yet.
        if (!entityId && json.entities?.length) setEntityId(json.entities[0].id);
        // Chat-capture: seed metric fields from the referenced governed measure.
        if (prefill?.measureId && !isEdit) {
          for (const e of json.entities) {
            const m = e.measures.find((mm) => mm.id === prefill.measureId);
            if (m) {
              setEntityId(e.id);
              setMetricType(m.metric_type);
              setAggregate(m.aggregate);
              if (m.column_name) setColumnName(m.column_name);
              if (!measureLabel) setMeasureLabel(m.measure_label);
              break;
            }
          }
        }
      } catch (e) {
        if (alive) setMetaError(e instanceof Error ? e.message : 'Failed to load model metadata');
      } finally {
        if (alive) setMetaLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const currentEntity = useMemo(() => meta.find((e) => e.id === entityId) ?? null, [meta, entityId]);
  const isColumnMetric = metricType === 'simple' || metricType === 'cumulative';
  const isExpressionMetric = metricType === 'ratio' || metricType === 'derived';

  // Changing a field invalidates any prior preview (the saved row is stale).
  const markDirty = useCallback(() => { setSaved(false); setPreview(null); if (!isEdit) setSavedId(null); }, [isEdit]);

  // ── Save (create or edit) ─────────────────────────────────────────────────
  const handleSave = useCallback(async (): Promise<string | null> => {
    setSaving(true);
    setSaveError(null);
    try {
      if (isEdit && edit) {
        // Editing a draft → free (gate handled server-side). PATCH allowlisted fields.
        const fields: Record<string, unknown> =
          tableKind === 'measure'
            ? {
                measure_label: measureLabel.trim(),
                metric_type: metricType,
                aggregate: isColumnMetric ? aggregate : 'sum',
                expression: isExpressionMetric ? expression.trim() : null,
                unit: unit.trim() || null,
                format_hint: formatHint.trim() || null,
                nl_intent: nlIntent.trim() || null,
              }
            : {
                dimension_label: dimensionLabel.trim(),
                dimension_type: dimensionType,
                format_hint: formatHint.trim() || null,
                nl_intent: nlIntent.trim() || null,
              };
        const res = await fetch(`/api/inspector/semantic/${modelId}/definitions/${edit.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableKind, fields }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `Save failed (${res.status})`);
        }
        setSaved(true);
        onSaved?.();
        return edit.id;
      }

      // Create a new draft.
      const fields: Record<string, unknown> =
        tableKind === 'measure'
          ? {
              entity_id: entityId,
              measure_label: measureLabel.trim(),
              metric_type: metricType,
              aggregate: isColumnMetric ? aggregate : null,
              column_name: isColumnMetric ? columnName.trim() : null,
              expression: isExpressionMetric ? expression.trim() : null,
              unit: unit.trim() || null,
              format_hint: formatHint.trim() || null,
              nl_intent: nlIntent.trim() || null,
            }
          : {
              entity_id: entityId,
              dimension_label: dimensionLabel.trim(),
              dimension_type: dimensionType,
              column_name: columnName.trim(),
              format_hint: formatHint.trim() || null,
              nl_intent: nlIntent.trim() || null,
            };
      const res = await fetch(`/api/inspector/semantic/${modelId}/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableKind, fields }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      const data = (await res.json()) as { definition?: { id: string } };
      const id = data.definition?.id ?? null;
      setSavedId(id);
      setSaved(true);
      onSaved?.();
      return id;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  }, [
    isEdit, edit, tableKind, modelId, entityId, measureLabel, metricType, aggregate, isColumnMetric,
    isExpressionMetric, expression, columnName, unit, formatHint, nlIntent, dimensionLabel, dimensionType, onSaved,
  ]);

  // ── Preview (authoring-mode execution) ───────────────────────────────────────
  const handlePreview = useCallback(async () => {
    setPreviewError(null);
    // Preview references definitions BY ID, so the draft must be persisted first.
    let id = savedId;
    if (!id || !saved) {
      id = await handleSave();
      if (!id) return; // save failed; error already surfaced
    }
    setPreviewing(true);
    try {
      const gb = groupById || null;
      const pair = pairMeasureId || null;
      const query =
        tableKind === 'measure'
          ? buildDraftPreviewQuery({ modelId, entityId, measureId: id, groupByDimensionId: gb })
          : buildDraftPreviewQuery({ modelId, entityId, measureId: pair, groupByDimensionId: id });

      if (tableKind === 'dimension' && !pair) {
        setPreviewError('Pick a measure to chart this dimension against.');
        setPreviewing(false);
        return;
      }

      const res = await fetch(`/api/inspector/semantic/${modelId}/authoring-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        rows?: Record<string, unknown>[]; sql?: string; rowCount?: number; isDraft?: boolean;
        definitionsUsed?: { dimensions: string[]; measures: string[] }; error?: string;
      };
      if (!res.ok) {
        setPreviewError(data.error ?? `Preview failed (${res.status})`);
        setPreviewing(false);
        return;
      }
      setPreview({
        rows: data.rows ?? [],
        sql: data.sql ?? '',
        rowCount: data.rowCount ?? 0,
        isDraft: !!data.isDraft,
        definitionsUsed: data.definitionsUsed ?? { dimensions: [], measures: [] },
        groupById: tableKind === 'measure' ? gb : id,
        pairMeasureId: tableKind === 'dimension' ? pair : null,
      });
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }, [savedId, saved, handleSave, groupById, pairMeasureId, tableKind, modelId, entityId]);

  // Auto-run the preview once (edit → "Preview" action). Measures only — a
  // dimension needs a paired measure the user must pick first.
  const [autoPreviewDone, setAutoPreviewDone] = useState(false);
  useEffect(() => {
    if (autoPreview && isEdit && !metaLoading && !autoPreviewDone && tableKind === 'measure') {
      setAutoPreviewDone(true);
      void handlePreview();
    }
  }, [autoPreview, isEdit, metaLoading, autoPreviewDone, tableKind, handlePreview]);

  // ── Build the preview widget + definition map for WidgetPreview ──────────────
  const previewWidget = useMemo<{ widget: WidgetSpec; defs: DefinitionMap } | null>(() => {
    if (!preview || !savedId) return null;
    const defs: DefinitionMap = new Map();
    let chartKind: WidgetSpec['chartKind'];
    let semanticMeasures: { measureId: string }[];
    let semanticDims: { dimensionId: string }[];

    if (tableKind === 'measure') {
      defs.set(savedId, {
        label: measureLabel.trim() || 'Metric',
        status: 'draft',
        aggregate: isColumnMetric ? aggregate : undefined,
        expression: isExpressionMetric ? expression : null,
        metric_type: metricType,
      });
      semanticMeasures = [{ measureId: savedId }];
      if (preview.groupById) {
        const dim = currentEntity?.dimensions.find((d) => d.id === preview.groupById);
        defs.set(preview.groupById, { label: dim?.dimension_label ?? 'Group', status: dim?.status ?? 'draft' });
        semanticDims = [{ dimensionId: preview.groupById }];
        chartKind = 'bar';
      } else {
        semanticDims = [];
        chartKind = 'kpi';
      }
    } else {
      // dimension preview paired with an existing measure
      const pair = preview.pairMeasureId;
      if (!pair) return null;
      const m = currentEntity?.measures.find((mm) => mm.id === pair);
      defs.set(pair, { label: m?.measure_label ?? 'Measure', status: m?.status ?? 'candidate', aggregate: m?.aggregate, metric_type: m?.metric_type });
      defs.set(savedId, { label: dimensionLabel.trim() || 'Dimension', status: 'draft' });
      semanticMeasures = [{ measureId: pair }];
      semanticDims = [{ dimensionId: savedId }];
      chartKind = 'bar';
    }

    const widget: WidgetSpec = {
      widgetId: 'draft-preview',
      title: tableKind === 'measure' ? (measureLabel.trim() || 'Metric') : (dimensionLabel.trim() || 'Dimension'),
      chartKind,
      semanticQuery: {
        modelId, entityId, dimensions: semanticDims, measures: semanticMeasures, filters: [], sorts: [], limit: 100,
      },
      measureSnapshots: [],
      chartConfig: {},
      position: { col: 0, row: 0, w: 6, h: 4 },
    };
    return { widget, defs };
  }, [preview, savedId, tableKind, measureLabel, dimensionLabel, aggregate, expression, metricType, isColumnMetric, isExpressionMetric, currentEntity, modelId, entityId]);

  // ── Validity for enabling Save ────────────────────────────────────────────
  const canSave = useMemo(() => {
    if (!entityId) return false;
    if (tableKind === 'measure') {
      if (!measureLabel.trim()) return false;
      if (isColumnMetric && (!columnName.trim() || !aggregate)) return false;
      if (isExpressionMetric && (!expression.trim() || exprUnsafe)) return false;
      return true;
    }
    return !!dimensionLabel.trim() && !!columnName.trim();
  }, [entityId, tableKind, measureLabel, isColumnMetric, columnName, aggregate, isExpressionMetric, expression, exprUnsafe, dimensionLabel]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--wb-canvas, #0D1B2A)',
        border: `1px solid ${BORDER_MID}`, borderRadius: 10,
        width: 'min(920px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${BORDER_SUBTLE}` }}>
          <Sparkles size={15} color={GOLD} />
          <div style={{ flex: 1 }}>
            <div style={{ ...sans, fontSize: 14, fontWeight: 600, color: 'var(--wb-ink)' }}>
              {isEdit ? 'Edit draft' : 'Define a metric'}
            </div>
            <div style={{ ...mono, fontSize: 9, color: MUTED, letterSpacing: '0.06em' }}>
              PERSONAL DRAFT · NOT GOVERNED UNTIL SUBMITTED
            </div>
          </div>
          <button onClick={onClose} title="Close" style={iconBtn}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* ── Left: the guided form ── */}
          <div style={{ flex: '0 0 46%', overflowY: 'auto', padding: 16, borderRight: `1px solid ${BORDER_SUBTLE}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {metaLoading && <div style={{ ...mono, fontSize: 10, color: MUTED }}>LOADING MODEL…</div>}
            {metaError && <div style={{ ...mono, fontSize: 10, color: RED }}>{metaError}</div>}

            {/* Kind toggle (locked in edit mode) */}
            <Field label="DEFINITION TYPE">
              <div style={{ display: 'flex', gap: 6 }}>
                {(['measure', 'dimension'] as const).map((k) => (
                  <button
                    key={k}
                    disabled={isEdit}
                    onClick={() => { setTableKind(k); markDirty(); }}
                    style={{
                      ...mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                      flex: 1, padding: '6px 0', borderRadius: 4, cursor: isEdit ? 'default' : 'pointer',
                      background: tableKind === k ? GOLD : 'transparent',
                      color: tableKind === k ? NAVY : MUTED,
                      border: `1px solid ${tableKind === k ? GOLD : BORDER_SUBTLE}`,
                      opacity: isEdit && tableKind !== k ? 0.4 : 1,
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </Field>

            {/* Entity */}
            <Field label="ENTITY">
              <select value={entityId} disabled={isEdit} onChange={(e) => { setEntityId(e.target.value); markDirty(); }} style={selectStyle}>
                <option value="">— select entity —</option>
                {meta.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.entity_label}{e.status !== 'governed' ? ` (${e.status})` : ''}
                  </option>
                ))}
              </select>
            </Field>

            {tableKind === 'measure' ? (
              <>
                <Field label="METRIC TYPE">
                  <select value={metricType} onChange={(e) => { setMetricType(e.target.value); markDirty(); }} style={selectStyle}>
                    {METRIC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>

                {isColumnMetric && (
                  <>
                    <Field label="COLUMN">
                      <input
                        list="dmp-columns"
                        value={columnName}
                        disabled={isEdit}
                        onChange={(e) => { setColumnName(e.target.value); markDirty(); }}
                        placeholder="e.g. revenue"
                        style={inputStyle}
                      />
                      <datalist id="dmp-columns">
                        {(currentEntity?.columns ?? []).map((c) => <option key={c} value={c} />)}
                      </datalist>
                      {isEdit && <Hint text="Column is structural — not editable after creation." />}
                    </Field>
                    <Field label="AGGREGATE">
                      <select value={aggregate ?? 'sum'} onChange={(e) => { setAggregate(e.target.value); markDirty(); }} style={selectStyle}>
                        {AGGREGATES.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </Field>
                  </>
                )}

                {isExpressionMetric && (
                  <Field label="EXPRESSION (SQL)">
                    <textarea
                      value={expression}
                      onChange={(e) => { setExpression(e.target.value); markDirty(); }}
                      rows={3}
                      placeholder="SUM(revenue) / NULLIF(SUM(orders), 0)"
                      style={{ ...inputStyle, resize: 'vertical', ...mono }}
                    />
                    {exprUnsafe && (
                      <div style={{ ...mono, fontSize: 9, color: RED, display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                        <AlertTriangle size={10} /> {exprUnsafe}
                      </div>
                    )}
                  </Field>
                )}

                <Field label="LABEL">
                  <input value={measureLabel} onChange={(e) => { setMeasureLabel(e.target.value); markDirty(); }} placeholder="Net Revenue Retention" style={inputStyle} />
                </Field>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Field label="UNIT" style={{ flex: 1 }}>
                    <input value={unit} onChange={(e) => { setUnit(e.target.value); markDirty(); }} placeholder="USD · %" style={inputStyle} />
                  </Field>
                  <Field label="FORMAT HINT" style={{ flex: 1 }}>
                    <input value={formatHint} onChange={(e) => { setFormatHint(e.target.value); markDirty(); }} placeholder="$0,0.00" style={inputStyle} />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field label="COLUMN">
                  <input
                    list="dmp-columns"
                    value={columnName}
                    disabled={isEdit}
                    onChange={(e) => { setColumnName(e.target.value); markDirty(); }}
                    placeholder="e.g. region"
                    style={inputStyle}
                  />
                  <datalist id="dmp-columns">
                    {(currentEntity?.columns ?? []).map((c) => <option key={c} value={c} />)}
                  </datalist>
                  {isEdit && <Hint text="Column is structural — not editable after creation." />}
                </Field>
                <Field label="DIMENSION TYPE">
                  <select value={dimensionType} onChange={(e) => { setDimensionType(e.target.value); markDirty(); }} style={selectStyle}>
                    {DIMENSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="LABEL">
                  <input value={dimensionLabel} onChange={(e) => { setDimensionLabel(e.target.value); markDirty(); }} placeholder="Region" style={inputStyle} />
                </Field>
              </>
            )}

            {/* NL intent — frictionless, gently nudged */}
            <Field label="WHAT QUESTION DOES THIS ANSWER?">
              <textarea
                value={nlIntent}
                onChange={(e) => setNlIntent(e.target.value)}
                rows={2}
                placeholder="e.g. How much recurring revenue did we retain this quarter?"
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              {!nlIntent.trim() && <Hint text="Adding a question helps others find this metric." />}
            </Field>
          </div>

          {/* ── Right: live preview ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Preview controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tableKind === 'measure' ? (
                <Field label="GROUP BY (OPTIONAL)">
                  <select value={groupById} onChange={(e) => { setGroupById(e.target.value); setPreview(null); }} style={selectStyle}>
                    <option value="">— none (single value) —</option>
                    {(currentEntity?.dimensions ?? []).map((d) => (
                      <option key={d.id} value={d.id}>{d.dimension_label}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="CHART AGAINST MEASURE">
                  <select value={pairMeasureId} onChange={(e) => { setPairMeasureId(e.target.value); setPreview(null); }} style={selectStyle}>
                    <option value="">— select a measure —</option>
                    {(currentEntity?.measures ?? []).map((m) => (
                      <option key={m.id} value={m.id}>{m.measure_label}</option>
                    ))}
                  </select>
                </Field>
              )}
              <button
                onClick={handlePreview}
                disabled={!canSave || previewing || (!!exprUnsafe)}
                style={{
                  ...mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '7px 0', borderRadius: 4, border: 'none',
                  background: (!canSave || previewing) ? SURFACE : GOLD, color: (!canSave || previewing) ? MUTED : NAVY,
                  cursor: (!canSave || previewing) ? 'default' : 'pointer', fontWeight: 600,
                }}
              >
                <Play size={12} /> {previewing ? 'RUNNING…' : 'PREVIEW'}
              </button>
              {previewError && <div style={{ ...mono, fontSize: 10, color: RED }}>{previewError}</div>}
            </div>

            {/* Preview render */}
            {previewWidget ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ position: 'relative', border: `1px solid ${BORDER_SUBTLE}`, borderRadius: 6, background: SURFACE, height: 240, overflow: 'hidden' }}>
                  <WidgetPreview widget={previewWidget.widget} definitions={previewWidget.defs} rows={preview!.rows} />
                  {preview!.isDraft && (
                    <span style={{
                      position: 'absolute', top: 8, right: 8, ...mono, fontSize: 9, letterSpacing: '0.08em',
                      textTransform: 'uppercase', background: 'rgba(253,181,21,0.14)', color: GOLD,
                      border: `1px solid ${BORDER_STRONG}`, borderRadius: 4, padding: '3px 8px',
                    }}>
                      Draft — not governed
                    </span>
                  )}
                </div>
                <TrustPanel
                  sql={preview!.sql}
                  rowCount={preview!.rowCount}
                  definitionsUsed={preview!.definitionsUsed}
                  summaryLabel="How this draft compiles"
                />
              </div>
            ) : (
              <div style={{
                flex: 1, minHeight: 160, border: `1px dashed ${BORDER_SUBTLE}`, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20,
              }}>
                <span style={{ ...mono, fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
                  Fill the form, then <span style={{ color: GOLD }}>PREVIEW</span> to see your draft<br />compute live against the warehouse.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderTop: `1px solid ${BORDER_SUBTLE}` }}>
          {saved && (
            <span style={{ ...mono, fontSize: 10, color: GREEN, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Check size={12} /> SAVED AS DRAFT
            </span>
          )}
          {saveError && <span style={{ ...mono, fontSize: 10, color: RED }}>{saveError}</span>}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostBtn}>CLOSE</button>
          <button
            onClick={() => handleSave()}
            disabled={!canSave || saving}
            style={{
              ...mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '7px 16px', borderRadius: 4, border: 'none', fontWeight: 600,
              background: (!canSave || saving) ? SURFACE : GOLD, color: (!canSave || saving) ? MUTED : NAVY,
              cursor: (!canSave || saving) ? 'default' : 'pointer',
            }}
          >
            {saving ? 'SAVING…' : isEdit ? 'SAVE CHANGES' : 'SAVE DRAFT'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────
function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <span style={{ ...mono, fontSize: 9, letterSpacing: '0.10em', color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function Hint({ text }: { text: string }) {
  return <span style={{ ...mono, fontSize: 9, color: MUTED, fontStyle: 'italic', marginTop: 2 }}>{text}</span>;
}

const inputStyle: React.CSSProperties = {
  ...sans, fontSize: 12, background: SURFACE, border: `1px solid ${BORDER_SUBTLE}`,
  borderRadius: 4, color: 'var(--wb-ink)', padding: '6px 8px', width: '100%', boxSizing: 'border-box', outline: 'none',
};
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };
const iconBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center' };
const ghostBtn: React.CSSProperties = {
  ...mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
  padding: '7px 14px', borderRadius: 4, background: 'transparent', color: MUTED, border: `1px solid ${BORDER_SUBTLE}`, cursor: 'pointer',
};
