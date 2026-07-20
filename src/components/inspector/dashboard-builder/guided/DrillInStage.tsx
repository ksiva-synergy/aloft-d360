'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Sparkles, ArrowLeft, Check, ChevronRight, SkipForward, FastForward, Database,
  Filter as FilterIcon, Palette, Code2, ChevronDown, Plus, X, AlertTriangle, CornerDownLeft,
  BarChart3, LineChart, ScatterChart, PieChart, Table2, Hash, Grid3x3,
} from 'lucide-react';
import { createId } from '@paralleldrive/cuid2';
import { useBuilderStore } from '../builder-store';
import { NotWiredChart } from './NotWiredChart';
import { awaitingData } from '@/lib/dashboards/widget-render-state';
import { blueprintToWidgetSpec } from '@/lib/dashboards/blueprint-widget';
import {
  recommendChartKind, recommendedKindToWidgetKind,
  type ResolvedDefinitions, type RecommendedChartKind,
} from '@/lib/dashboards/chart-defaults';
import type { ChartBlueprint } from '@/lib/dashboards/guided-types';
import type { SemanticWidgetSpec, WidgetSpec } from '@/lib/dashboards/types';
import { isSemanticWidget } from '@/lib/dashboards/types';
import type { SemanticFilter, SemanticQuery, FilterOp } from '@/lib/semantic/types';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const GOLD = '#FDB515';
const GREEN = '#34D399';
const VIOLET = '#C4B5FD';
const BLUE = '#93C5FD';
const MUTED = '#8892A4';
const INK = 'var(--wb-ink, #E6ECF5)';

type NumFmt = 'auto' | 'compact' | 'percent' | 'currency';

/** Per-item working copy — pre-fill for the panel; committed on Confirm. */
interface DrillDraft {
  title: string;
  chartKind: SemanticWidgetSpec['chartKind'];
  filters: SemanticFilter[];
  /** Single ECharts colour override; '' = auto (theme default). */
  color: string;
  /** Captured now, applied at render (data half) — see Polish section. */
  format: NumFmt;
  /** NL-refine text; held in state this phase, re-runs with the data half. */
  refineText: string;
}

interface Props {
  /** The dashboard's bound model — carried into the WidgetSpec's defensive pin. */
  modelId: string;
  /**
   * Resolved dimension/measure metadata (types drive recommendChartKind). Passed
   * from the builder's already-loaded definitions so the Visual "why this" panel
   * reproduces the SAME recommendation the server used for chartKindGuess.
   */
  resolvedDefs: ResolvedDefinitions;
  /** Return to Stage 2 (Blueprint). */
  onBackToBlueprint?: () => void;
  /** All items handled — drop into the grid (manual) to arrange + save (Phase 5). */
  onDone?: () => void;
}

/** A blueprint item maps to a real widget only when it's governed. */
function isConfirmable(item: ChartBlueprint): boolean {
  return item.grounding === 'governed';
}

/** Build the working query for an item + draft (IDs only — labels stay live). */
function draftQuery(item: ChartBlueprint, draft: DrillDraft, modelId: string): SemanticQuery {
  return {
    // Defensive pin: the dashboard's model, never a stored value.
    modelId,
    // entityId is resolved SERVER-SIDE at save (the defer-to-first-save binding
    // decision) — the client has no catalog to resolve field IDs → entity. This
    // matches manual addWidget, which also seeds entityId '' and lets save bind it.
    entityId: '',
    dimensions: item.dimensionIds.map((dimensionId) => ({ dimensionId })),
    measures: item.measureIds.map((measureId) => ({ measureId })),
    filters: draft.filters,
    sorts: [],
  };
}

/** chartConfig from Polish edits. Only real ECharts keys are persisted; number
 *  format is intentionally NOT written (no live renderer yet — see Polish). */
function draftChartConfig(draft: DrillDraft): SemanticWidgetSpec['chartConfig'] {
  if (!draft.color) return {};
  return { echartsOption: { color: [draft.color] } };
}

export function DrillInStage({ modelId, resolvedDefs, onBackToBlueprint, onDone }: Props) {
  const blueprint = useBuilderStore((s) => s.guidedSession.blueprint);
  const drillIn = useBuilderStore((s) => s.guidedSession.drillIn);
  const widgets = useBuilderStore((s) => s.widgets);
  const setDrillInCursor = useBuilderStore((s) => s.setDrillInCursor);
  const recordDrillInConfirm = useBuilderStore((s) => s.recordDrillInConfirm);
  const appendWidgetSpec = useBuilderStore((s) => s.appendWidgetSpec);
  const updateWidget = useBuilderStore((s) => s.updateWidget);
  const updateWidgetSemanticQuery = useBuilderStore((s) => s.updateWidgetSemanticQuery);

  const items = blueprint?.items ?? [];
  const cursor = Math.min(drillIn.cursor, Math.max(0, items.length - 1));
  const current = items[cursor];

  // Working drafts, keyed by blueprint item id. Lazily seeded from the confirmed
  // widget (if any) else the blueprint item. Uncommitted edits live here for the
  // life of this mount; only a Confirm writes them into the shared WidgetSpec[].
  const [drafts, setDrafts] = useState<Record<string, DrillDraft>>({});

  const seedDraft = useCallback(
    (item: ChartBlueprint): DrillDraft => {
      const wid = drillIn.widgetIdByItemId[item.id];
      const w = wid ? widgets.find((x) => x.widgetId === wid) : undefined;
      if (w && isSemanticWidget(w)) {
        const color = extractColor(w.chartConfig);
        return { title: w.title, chartKind: w.chartKind, filters: w.semanticQuery.filters, color, format: 'auto', refineText: '' };
      }
      return {
        title: item.title,
        chartKind: recommendedKindToWidgetKind(item.chartKindGuess),
        filters: item.filters,
        color: '',
        format: 'auto',
        refineText: '',
      };
    },
    [drillIn.widgetIdByItemId, widgets],
  );

  const draft = current ? (drafts[current.id] ?? seedDraft(current)) : null;

  const patchDraft = useCallback(
    (patch: Partial<DrillDraft>) => {
      if (!current) return;
      setDrafts((d) => ({ ...d, [current.id]: { ...(d[current.id] ?? seedDraft(current)), ...patch } }));
    },
    [current, seedDraft],
  );

  const confirmedCount = useMemo(
    () => items.filter((i) => drillIn.widgetIdByItemId[i.id]).length,
    [items, drillIn.widgetIdByItemId],
  );

  // ── Confirm (append or patch) — spec mutation only, no execution. ────────────
  const commit = useCallback(
    (item: ChartBlueprint, d: DrillDraft) => {
      if (!isConfirmable(item)) return; // undefined item — nothing governed to bind
      const existingId = drillIn.widgetIdByItemId[item.id];
      const query = draftQuery(item, d, modelId);
      if (existingId) {
        // PATCH the already-appended widget in place.
        updateWidget(existingId, { title: d.title, chartKind: d.chartKind, chartConfig: draftChartConfig(d) });
        updateWidgetSemanticQuery(existingId, query);
        return;
      }
      // APPEND: build via the Phase-3 mapping (IDs live, measureSnapshots [] to be
      // re-frozen server-side at save), then overlay the drill-in edits.
      const widgetId = createId();
      const base = blueprintToWidgetSpec(item, { modelId, entityId: '', widgetId });
      if (!base) return; // grounding !== 'governed' — never fabricate
      const spec: SemanticWidgetSpec = {
        ...base,
        title: d.title,
        chartKind: d.chartKind,
        chartConfig: draftChartConfig(d),
        semanticQuery: query,
      };
      appendWidgetSpec(spec);
      recordDrillInConfirm(item.id, widgetId);
    },
    [drillIn.widgetIdByItemId, modelId, appendWidgetSpec, recordDrillInConfirm, updateWidget, updateWidgetSemanticQuery],
  );

  const goTo = useCallback((i: number) => setDrillInCursor(Math.max(0, Math.min(i, items.length - 1))), [items.length, setDrillInCursor]);

  const handleConfirmAndNext = useCallback(() => {
    if (!current || !draft) return;
    commit(current, draft);
    if (cursor < items.length - 1) goTo(cursor + 1);
  }, [current, draft, commit, cursor, items.length, goTo]);

  // "Accept the rest as-is" — confirm every remaining governed, unconfirmed item
  // with its seeded defaults. Never a locked stepper: this is an escape hatch.
  const handleAcceptRest = useCallback(() => {
    for (const item of items) {
      if (!isConfirmable(item)) continue;
      if (drillIn.widgetIdByItemId[item.id]) continue;
      commit(item, drafts[item.id] ?? seedDraft(item));
    }
  }, [items, drillIn.widgetIdByItemId, drafts, seedDraft, commit]);

  if (!blueprint || items.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ ...MONO, fontSize: 11, color: MUTED }}>No blueprint to refine — go back and propose one.</span>
      </div>
    );
  }

  const allGovernedConfirmed = items.filter(isConfirmable).every((i) => drillIn.widgetIdByItemId[i.id]);

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }} data-testid="drill-in-stage">
      {/* ── Progress rail = the blueprint (jump / skip / accept-rest) ──────────── */}
      <div
        style={{
          width: 232, flexShrink: 0, borderRight: '1px solid rgba(136,146,164,0.18)',
          display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'rgba(0,0,0,0.12)',
        }}
        data-testid="drill-in-rail"
      >
        <div style={{ padding: '14px 14px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <Sparkles size={13} color={GOLD} />
            <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: GOLD }}>
              Guided · Step 3 · Refine
            </span>
          </div>
          <span style={{ ...MONO, fontSize: 9.5, color: MUTED }}>
            {confirmedCount}/{items.filter(isConfirmable).length} charts added · jump to any
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px', flex: 1 }}>
          {items.map((item, i) => {
            const confirmed = !!drillIn.widgetIdByItemId[item.id];
            const undef = !isConfirmable(item);
            const active = i === cursor;
            return (
              <button
                key={item.id}
                onClick={() => goTo(i)}
                aria-current={active ? 'true' : undefined}
                data-confirmed={confirmed ? 'true' : 'false'}
                style={{
                  ...MONO, fontSize: 10.5, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer', color: INK,
                  border: `1px solid ${active ? `${GOLD}66` : 'transparent'}`,
                  background: active ? 'rgba(253,181,21,0.08)' : 'transparent',
                }}
              >
                <StatusDot confirmed={confirmed} undef={undef} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </span>
                <KindGlyph kind={item.chartKindGuess} color={undef ? VIOLET : confirmed ? GREEN : MUTED} />
              </button>
            );
          })}
        </div>

        <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(136,146,164,0.15)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={handleAcceptRest} style={railBtn(GOLD)} title="Confirm every remaining governed chart with its defaults">
            <FastForward size={12} /> Accept the rest as-is
          </button>
          {onBackToBlueprint && (
            <button onClick={onBackToBlueprint} style={{ ...MONO, fontSize: 9.5, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ArrowLeft size={11} /> Back to blueprint
            </button>
          )}
        </div>
      </div>

      {/* ── Chart area (not wired) + NL-refine bar ────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '18px 20px', overflowY: 'auto', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...MONO, fontSize: 14, fontWeight: 600, color: INK }}>{draft?.title}</span>
          {current && drillIn.widgetIdByItemId[current.id] && (
            <span style={{ ...MONO, fontSize: 9, color: GREEN, border: `1px solid ${GREEN}55`, borderRadius: 4, padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Check size={10} /> Added to dashboard
            </span>
          )}
        </div>

        <NotWiredChart state={awaitingData()} chartKindGuess={current?.chartKindGuess} />

        {/* NL-refine — present + wired into state, but inert this phase. */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(136,146,164,0.28)', background: 'rgba(0,0,0,0.18)' }}>
            <Sparkles size={13} color={MUTED} style={{ flexShrink: 0 }} />
            <input
              value={draft?.refineText ?? ''}
              onChange={(e) => patchDraft({ refineText: e.target.value })}
              placeholder="Refine in words — e.g. “break out by vessel type”, “last quarter only”"
              aria-label="Refine this chart in natural language"
              style={{ ...MONO, fontSize: 11.5, flex: 1, background: 'transparent', border: 'none', outline: 'none', color: INK }}
            />
          </div>
          <button
            disabled
            title="Refine runs the grounded pipeline once data is wired (data layer)"
            style={{
              ...MONO, fontSize: 10, letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0 14px', borderRadius: 8, border: '1px dashed rgba(136,146,164,0.4)',
              background: 'transparent', color: MUTED, cursor: 'not-allowed', whiteSpace: 'nowrap',
            }}
          >
            <CornerDownLeft size={12} /> Refine runs once data is wired
          </button>
        </div>
      </div>

      {/* ── Panel: Source / Filters / Visual / Polish ─────────────────────────── */}
      {current && draft && (
        <div
          style={{ width: 320, flexShrink: 0, borderLeft: '1px solid rgba(136,146,164,0.18)', overflowY: 'auto', background: 'rgba(0,0,0,0.12)' }}
          data-testid="drill-in-panel"
        >
          <SourceSection item={current} modelStatus={blueprint.modelStatus} />
          <FiltersSection item={current} draft={draft} onChange={(filters) => patchDraft({ filters })} />
          <VisualSection item={current} draft={draft} resolvedDefs={resolvedDefs} modelId={modelId} onPick={(k) => patchDraft({ chartKind: k })} />
          <PolishSection draft={draft} onChange={patchDraft} />

          {/* Confirm → append/patch WidgetSpec */}
          <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(136,146,164,0.15)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isConfirmable(current) ? (
              <>
                <button onClick={handleConfirmAndNext} style={primaryBtn()} data-testid="drill-in-confirm">
                  {drillIn.widgetIdByItemId[current.id] ? 'Update chart' : 'Add to dashboard'}
                  <ChevronRight size={13} />
                </button>
                {cursor < items.length - 1 && (
                  <button onClick={() => goTo(cursor + 1)} style={{ ...MONO, fontSize: 9.5, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                    <SkipForward size={11} /> Skip for now
                  </button>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={12} color={VIOLET} />
                  <span style={{ ...MONO, fontSize: 10, color: VIOLET }}>Not defined yet — can’t add</span>
                </div>
                <span style={{ ...MONO, fontSize: 9.5, color: MUTED, lineHeight: 1.5 }}>
                  This chart needs a metric that isn’t governed. Define it in Teach, then it becomes addable — we won’t fabricate a chart with no data.
                </span>
                <button onClick={() => goTo(cursor + 1)} style={{ ...MONO, fontSize: 9.5, color: MUTED, background: 'transparent', border: '1px solid rgba(136,146,164,0.25)', borderRadius: 6, padding: '6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                  <SkipForward size={11} /> Skip this one
                </button>
              </div>
            )}

            {allGovernedConfirmed && onDone && (
              <button onClick={onDone} style={{ ...primaryBtn(), background: GREEN }} data-testid="drill-in-done">
                <Check size={13} /> Done — arrange &amp; save
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Panel sections
 * ──────────────────────────────────────────────────────────────────────────── */

function SourceSection({ item, modelStatus }: { item: ChartBlueprint; modelStatus: 'governed' | 'candidate' }) {
  const [sqlOpen, setSqlOpen] = useState(false);
  return (
    <PanelSection icon={<Database size={12} color={BLUE} />} label="Source">
      {modelStatus === 'candidate' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 6, border: `1px solid ${VIOLET}55`, background: `${VIOLET}12`, marginBottom: 8 }}>
          <AlertTriangle size={11} color={VIOLET} />
          <span style={{ ...MONO, fontSize: 9.5, color: INK, lineHeight: 1.4 }}>Model isn’t governed — renders in draft (owner-only) until published.</span>
        </div>
      )}
      <FieldList label="Measures" ids={item.measureIds} labels={item.measureLabels} color={GREEN} />
      <FieldList label="Dimensions" ids={item.dimensionIds} labels={item.dimensionLabels} color={BLUE} />

      {/* Read-only SQL trust-panel slot — populated by the data half. */}
      <button onClick={() => setSqlOpen((o) => !o)} style={{ ...MONO, fontSize: 9.5, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 0 0' }}>
        <ChevronDown size={11} style={{ transform: sqlOpen ? 'none' : 'rotate(-90deg)', transition: 'transform 0.1s' }} />
        Compiled SQL
      </button>
      {sqlOpen && (
        <div data-testid="sql-trust-panel" style={{ ...MONO, fontSize: 9.5, color: MUTED, padding: '8px 10px', borderRadius: 6, border: '1px dashed rgba(136,146,164,0.3)', background: 'rgba(0,0,0,0.2)', marginTop: 4, lineHeight: 1.5 }}>
          SQL available once wired — the read-only trust panel shows the compiled query when the data layer is connected.
        </div>
      )}
    </PanelSection>
  );
}

function FiltersSection({ item, draft, onChange }: { item: ChartBlueprint; draft: DrillDraft; onChange: (filters: SemanticFilter[]) => void }) {
  // Add-filter field list = the item's own governed fields (never a fabricated
  // ref; filters are governed semanticQuery filters, not client row hacks).
  const fields = useMemo(() => {
    const out: { id: string; label: string; kind: 'measure' | 'dimension' }[] = [];
    item.measureIds.forEach((id, i) => out.push({ id, label: item.measureLabels[i] ?? id, kind: 'measure' }));
    item.dimensionIds.forEach((id, i) => out.push({ id, label: item.dimensionLabels[i] ?? id, kind: 'dimension' }));
    return out;
  }, [item]);

  const labelFor = useCallback((id: string) => fields.find((f) => f.id === id)?.label ?? id, [fields]);

  const addFilter = useCallback(() => {
    const f = fields[0];
    if (!f) return;
    onChange([...draft.filters, { fieldId: f.id, fieldKind: f.kind, op: 'eq', value: '' }]);
  }, [fields, draft.filters, onChange]);

  const patchAt = useCallback(
    (idx: number, patch: Partial<SemanticFilter>) => {
      onChange(draft.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
    },
    [draft.filters, onChange],
  );
  const removeAt = useCallback((idx: number) => onChange(draft.filters.filter((_, i) => i !== idx)), [draft.filters, onChange]);

  return (
    <PanelSection icon={<FilterIcon size={12} color={GOLD} />} label="Filters">
      {draft.filters.length === 0 && (
        <span style={{ ...MONO, fontSize: 9.5, color: MUTED }}>No filters — the chart uses every row the metric returns.</span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {draft.filters.map((f, i) => (
          <div key={i} data-testid="filter-row" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <select value={f.fieldId} onChange={(e) => patchAt(i, { fieldId: e.target.value, fieldKind: fields.find((x) => x.id === e.target.value)?.kind ?? f.fieldKind })} style={selectStyle()} aria-label="Filter field">
              {fields.map((fl) => <option key={fl.id} value={fl.id}>{fl.label}</option>)}
              {!fields.some((fl) => fl.id === f.fieldId) && <option value={f.fieldId}>{labelFor(f.fieldId)}</option>}
            </select>
            <select value={f.op} onChange={(e) => patchAt(i, { op: e.target.value as FilterOp })} style={{ ...selectStyle(), width: 62, flex: 'none' }} aria-label="Filter operator">
              {(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'between', 'is_null', 'is_not_null'] as FilterOp[]).map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            {f.op !== 'is_null' && f.op !== 'is_not_null' && (
              <input value={String(f.value ?? '')} onChange={(e) => patchAt(i, { value: e.target.value })} placeholder="value" aria-label="Filter value" style={{ ...selectStyle(), width: 60, flex: 'none' }} />
            )}
            <button onClick={() => removeAt(i)} aria-label="Remove filter" style={{ background: 'transparent', border: 'none', color: '#F87171', cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {fields.length > 0 && (
        <button onClick={addFilter} style={{ ...MONO, fontSize: 9.5, color: MUTED, background: 'transparent', border: '1px dashed rgba(136,146,164,0.35)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
          <Plus size={11} /> Add filter
        </button>
      )}
    </PanelSection>
  );
}

function VisualSection({
  item, draft, resolvedDefs, modelId, onPick,
}: {
  item: ChartBlueprint;
  draft: DrillDraft;
  resolvedDefs: ResolvedDefinitions;
  modelId: string;
  onPick: (kind: SemanticWidgetSpec['chartKind']) => void;
}) {
  // Reproduce the SAME recommendation the server used for chartKindGuess (same
  // pure function, same resolvedDefs source) — so "why this" + alternatives are
  // consistent with the blueprint, not a second, drifting inference.
  const rec = useMemo(
    () => recommendChartKind(draftQuery(item, draft, modelId), resolvedDefs),
    [item, draft, modelId, resolvedDefs],
  );
  const gallery: RecommendedChartKind[] = [rec.chartKind, ...rec.alternatives];

  return (
    <PanelSection icon={<BarChart3 size={12} color={GREEN} />} label="Visual">
      <p style={{ ...MONO, fontSize: 9.5, color: MUTED, margin: '0 0 8px', lineHeight: 1.5 }}>
        Recommended: <strong style={{ color: INK }}>{rec.chartKind}</strong> — {rec.rationale}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {gallery.map((k) => {
          const widgetKind = recommendedKindToWidgetKind(k);
          const selected = draft.chartKind === widgetKind;
          return (
            <button
              key={k}
              onClick={() => onPick(widgetKind)}
              aria-pressed={selected}
              title={k === rec.chartKind ? 'Recommended' : `Alternative: ${k}`}
              style={{
                ...MONO, fontSize: 9.5, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${selected ? GREEN : 'rgba(136,146,164,0.25)'}`,
                background: selected ? `${GREEN}18` : 'transparent', color: selected ? GREEN : INK,
              }}
            >
              <KindGlyph kind={k} color={selected ? GREEN : MUTED} />
              {k}{k === rec.chartKind ? ' ★' : ''}
            </button>
          );
        })}
      </div>
    </PanelSection>
  );
}

function PolishSection({ draft, onChange }: { draft: DrillDraft; onChange: (patch: Partial<DrillDraft>) => void }) {
  const swatches = ['', GOLD, GREEN, BLUE, VIOLET, '#F87171'];
  return (
    <PanelSection icon={<Palette size={12} color={VIOLET} />} label="Polish">
      <label style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>Title</label>
      <input value={draft.title} onChange={(e) => onChange({ title: e.target.value })} aria-label="Chart title" style={{ ...selectStyle(), width: '100%', marginTop: 4, marginBottom: 12 }} />

      <label style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>Colour</label>
      <div style={{ display: 'flex', gap: 6, marginTop: 4, marginBottom: 12 }}>
        {swatches.map((c) => (
          <button
            key={c || 'auto'}
            onClick={() => onChange({ color: c })}
            aria-label={c ? `Colour ${c}` : 'Auto colour'}
            aria-pressed={draft.color === c}
            style={{
              width: 22, height: 22, borderRadius: 5, cursor: 'pointer',
              border: `2px solid ${draft.color === c ? INK : 'transparent'}`,
              background: c || 'transparent',
              ...(c ? {} : { ...MONO, fontSize: 8, color: MUTED, borderColor: 'rgba(136,146,164,0.4)' }),
            }}
          >
            {c ? '' : 'A'}
          </button>
        ))}
      </div>

      <label style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>Number format</label>
      <select value={draft.format} onChange={(e) => onChange({ format: e.target.value as NumFmt })} aria-label="Number format" style={{ ...selectStyle(), width: '100%', marginTop: 4 }}>
        <option value="auto">Auto</option>
        <option value="compact">Compact (1.2k)</option>
        <option value="percent">Percent</option>
        <option value="currency">Currency</option>
      </select>
      <span style={{ ...MONO, fontSize: 9, color: MUTED, display: 'block', marginTop: 5, lineHeight: 1.4 }}>
        Applied to the chart once it renders with data.
      </span>
    </PanelSection>
  );
}

/* ── Small shared bits ──────────────────────────────────────────────────────── */

function PanelSection({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(136,146,164,0.12)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        {icon}
        <span style={{ ...MONO, fontSize: 9.5, letterSpacing: '0.10em', textTransform: 'uppercase', color: INK, fontWeight: 600 }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function FieldList({ label, ids, labels, color }: { label: string; ids: string[]; labels: string[]; color: string }) {
  if (ids.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ ...MONO, fontSize: 8.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3 }}>
        {ids.map((id, i) => (
          <div key={id} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ ...MONO, fontSize: 10.5, color }}>{labels[i] ?? id}</span>
            <span style={{ ...MONO, fontSize: 8.5, color: MUTED, opacity: 0.7 }} title="governed definition id">{id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ confirmed, undef }: { confirmed: boolean; undef: boolean }) {
  const color = undef ? VIOLET : confirmed ? GREEN : MUTED;
  return (
    <span
      aria-hidden
      style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: confirmed ? color : 'transparent', border: `1.5px solid ${color}`,
      }}
    />
  );
}

function KindGlyph({ kind, color }: { kind: string; color: string }) {
  const s = 13;
  switch (kind) {
    case 'kpi': return <Hash size={s} color={color} />;
    case 'line': return <LineChart size={s} color={color} />;
    case 'scatter': return <ScatterChart size={s} color={color} />;
    case 'heatmap': return <Grid3x3 size={s} color={color} />;
    case 'pie': case 'donut': return <PieChart size={s} color={color} />;
    case 'table': return <Table2 size={s} color={color} />;
    default: return <BarChart3 size={s} color={color} />;
  }
}

function extractColor(config: SemanticWidgetSpec['chartConfig']): string {
  const opt = config?.echartsOption as { color?: unknown } | undefined;
  if (opt && Array.isArray(opt.color) && typeof opt.color[0] === 'string') return opt.color[0];
  return '';
}

function railBtn(color: string): React.CSSProperties {
  return {
    ...MONO, fontSize: 10, letterSpacing: '0.03em', display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center',
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${color}55`, background: `${color}12`, color, cursor: 'pointer',
  };
}

function primaryBtn(): React.CSSProperties {
  return {
    ...MONO, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center',
    padding: '9px 14px', borderRadius: 6, border: 'none', background: GOLD, color: '#0D1B2A', cursor: 'pointer', fontWeight: 500,
  };
}

function selectStyle(): React.CSSProperties {
  return {
    ...MONO, fontSize: 10.5, flex: 1, minWidth: 0, padding: '5px 7px', borderRadius: 5,
    border: '1px solid rgba(136,146,164,0.3)', background: 'rgba(0,0,0,0.25)', color: INK, outline: 'none',
  };
}
