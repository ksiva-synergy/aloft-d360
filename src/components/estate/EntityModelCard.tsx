'use client';

// EntityModelCard — T4 entity model for this table, for data engineers.
// Technical names throughout (as stored in platform_sem_*).
//
//   header      entity_label, full_path, model, status, synonyms, promote
//   checks      model validation against the table's real columns:
//               aggregate on non-numeric column, SUM on a flag, MIN/MAX on an
//               identifier, temporal dimension that is not a date type,
//               high-cardinality categorical, high null_rate, missing column
//   example     SQL generated from the model (copyable)
//   measures    measure_label | definition | metric_type | data_type | unit | status
//   dimensions  grouped by dimension_type: label | column | data_type |
//               distinct_est | null_rate | synonyms | status
//   joins       platform_sem_joins in / out with join_on_sql
//   coverage    columns referenced by the model
//   ai_context  + platform_sem_audit trail
//
// Promote → POST /api/inspector/semantic/[modelId]/promote.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type } from '@/lib/typography/tokens';
import { Card, Tag, BTN_PRIMARY, BTN_SECONDARY, EmptyNote, CodeBlock, TONE_COLOR, relTime, fullTime, type Tone } from './object-ui';

// ── Types (serialized SemanticModelView from reads.ts) ───────────────────────

export interface ModelDimension {
  id?: string; column_name: string; dimension_label: string; dimension_type: string; description: string | null;
  status?: string; synonyms?: string[]; format_hint?: string | null; nl_intent?: string | null;
}
export interface ModelMeasure {
  id?: string; column_name: string | null; measure_label: string; aggregate: string; expression?: string | null;
  metric_type?: string; description: string | null; unit: string | null; status?: string; synonyms?: string[];
  format_hint?: string | null; nl_intent?: string | null;
}
export interface ModelJoin {
  id: string; direction: 'out' | 'in'; join_type: string; join_on_sql: string; description: string | null;
  other: { id: string; entity_label: string; full_path: string };
}
export interface ModelAudit {
  table_name: string; row_id: string; action: string; from_status: string | null; to_status: string | null;
  changed_by: string; created_at: string;
}
export interface TableColumn {
  name: string; data_type: string | null; ordinal: number | null; profile?: any; semantic?: any;
}

interface EntityModelCardProps {
  entity_id: string;
  entity_model_id: string | null;
  entity_label: string;
  description: string | null;
  status: string;
  dimensions: ModelDimension[];
  measures: ModelMeasure[];
  fullPath?: string;
  ai_context?: string | null;
  synonyms?: string[];
  created_by?: string | null;
  updated_at?: string | null;
  model?: { id: string; name: string; status: string } | null;
  joins?: ModelJoin[];
  audit?: ModelAudit[];
  /** The table's columns — used for data_type / profile checks and coverage. */
  columns?: TableColumn[];
  onColumnClick?: (name: string) => void;
  onPromoted?: () => void;
}

const STATUS_TONE: Record<string, Tone> = {
  candidate: 'amber', proposed: 'amber', draft: 'amber',
  governed: 'green', certified: 'green', approved: 'green',
  rejected: 'red', deprecated: 'red',
};

const DIM_ORDER = ['identifier', 'temporal', 'categorical', 'attribute'];
const NUMERIC_RE = /\b(tinyint|smallint|int|integer|bigint|long|short|byte|decimal|numeric|double|float|real)\b/i;
const TEMPORAL_RE = /\b(date|timestamp|timestamp_ntz|datetime|time)\b/i;
const NUMERIC_AGGS = new Set(['sum', 'avg', 'mean', 'median', 'stddev', 'variance', 'percentile']);
const HIGH_CARDINALITY = 1000;
const HIGH_NULL_RATE = 0.5;

type Severity = 'error' | 'warn';
interface Check { severity: Severity; target: string; message: string }

// ── Validation ───────────────────────────────────────────────────────────────

function runChecks(dimensions: ModelDimension[], measures: ModelMeasure[], columns: TableColumn[]): Map<string, Check[]> {
  const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  const out = new Map<string, Check[]>();
  const add = (key: string, c: Check) => out.set(key, [...(out.get(key) ?? []), c]);
  if (columns.length === 0) return out;

  for (const m of measures) {
    const key = `m:${m.measure_label}`;
    if (!m.column_name) continue; // expression-only measure — nothing to check against
    const col = byName.get(m.column_name.toLowerCase());
    const agg = m.aggregate.toLowerCase();
    if (!col) {
      add(key, { severity: 'error', target: m.measure_label, message: `column_name ${m.column_name} not found in table` });
      continue;
    }
    const dt = col.data_type ?? '';
    if (NUMERIC_AGGS.has(agg) && dt && !NUMERIC_RE.test(dt)) {
      add(key, { severity: 'error', target: m.measure_label, message: `${agg.toUpperCase()} on non-numeric column (${dt})` });
    }
    const isFlag = /boolean/i.test(dt) || col.semantic?.role === 'flag' || /(^|_)(flag|is_|has_)/i.test(col.name);
    if (agg === 'sum' && isFlag) {
      add(key, { severity: 'warn', target: m.measure_label, message: `SUM on flag column ${col.name} — counts true values only if 0/1` });
    }
    const isIdentifier = col.semantic?.role === 'key' || /(row_?num(ber)?|(^|_)id)$/i.test(col.name);
    if ((agg === 'max' || agg === 'min') && isIdentifier) {
      add(key, { severity: 'warn', target: m.measure_label, message: `${agg.toUpperCase()} on identifier ${col.name} — not a metric` });
    }
  }

  for (const d of dimensions) {
    const key = `d:${d.column_name}`;
    const col = byName.get(d.column_name.toLowerCase());
    if (!col) {
      add(key, { severity: 'error', target: d.dimension_label, message: `column_name ${d.column_name} not found in table` });
      continue;
    }
    const dt = col.data_type ?? '';
    if (d.dimension_type === 'temporal' && dt && !TEMPORAL_RE.test(dt)) {
      add(key, { severity: 'warn', target: d.dimension_label, message: `temporal dimension on ${dt} column` });
    }
    const distinct = Number(col.profile?.distinct_est);
    if (d.dimension_type === 'categorical' && Number.isFinite(distinct) && distinct > HIGH_CARDINALITY) {
      add(key, { severity: 'warn', target: d.dimension_label, message: `categorical with distinct_est ${distinct.toLocaleString()} — high cardinality` });
    }
    const nullRate = Number(col.profile?.null_rate);
    if (Number.isFinite(nullRate) && nullRate >= HIGH_NULL_RATE) {
      add(key, { severity: 'warn', target: d.dimension_label, message: `null_rate ${(nullRate * 100).toFixed(0)}%` });
    }
  }
  return out;
}

// ── Example SQL ──────────────────────────────────────────────────────────────

function sqlIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name.replace(/`/g, '``')}\``;
}
function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'value';
}

function exampleSql(fullPath: string, dimensions: ModelDimension[], measures: ModelMeasure[]): string | null {
  if (measures.length === 0) return null;
  const temporal = dimensions.find((d) => d.dimension_type === 'temporal');
  const category = dimensions.find((d) => d.dimension_type === 'categorical') ?? dimensions.find((d) => d.dimension_type === 'attribute');
  const select: string[] = [];
  if (category) select.push(`  ${sqlIdent(category.column_name)}`);
  if (temporal) select.push(`  DATE_TRUNC('month', ${sqlIdent(temporal.column_name)}) AS ${slug(temporal.column_name)}_month`);
  for (const m of measures.slice(0, 3)) {
    const agg = m.aggregate.toLowerCase();
    const expr = m.expression?.trim()
      || (agg === 'count_distinct'
        ? `COUNT(DISTINCT ${m.column_name ? sqlIdent(m.column_name) : '*'})`
        : `${(agg === 'mean' ? 'avg' : agg).toUpperCase()}(${m.column_name ? sqlIdent(m.column_name) : '*'})`);
    select.push(`  ${expr} AS ${slug(m.measure_label)}`);
  }
  const groupCount = (category ? 1 : 0) + (temporal ? 1 : 0);
  const lines = [
    'SELECT',
    select.join(',\n'),
    `FROM ${fullPath.split('.').map(sqlIdent).join('.')}`,
  ];
  if (groupCount > 0) {
    lines.push(`GROUP BY ${Array.from({ length: groupCount }, (_, i) => i + 1).join(', ')}`);
    lines.push(`ORDER BY ${groupCount}`);
  }
  return lines.join('\n');
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function ColumnRef({ name, onClick }: { name: string; onClick?: (n: string) => void }) {
  const style: React.CSSProperties = { ...type['code-inline'], color: 'var(--estate-ink)', background: 'none', border: 'none', padding: 0, textAlign: 'left' };
  return onClick
    ? <button type="button" onClick={() => onClick(name)} title={`Show ${name} in the columns table`} className="hover:underline" style={{ ...style, cursor: 'pointer' }}>{name}</button>
    : <code style={style}>{name}</code>;
}

function CheckDot({ checks }: { checks: Check[] | undefined }) {
  if (!checks || checks.length === 0) {
    return <span title="No issues" style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>—</span>;
  }
  const err = checks.some((c) => c.severity === 'error');
  return (
    <span
      title={checks.map((c) => c.message).join('\n')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...type.caption, fontWeight: 600, color: err ? TONE_COLOR.red : TONE_COLOR.amber, whiteSpace: 'nowrap' }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: err ? TONE_COLOR.red : TONE_COLOR.amber }} />
      {checks.length} {checks.length === 1 ? 'issue' : 'issues'}
    </span>
  );
}

function StatusCell({ status }: { status?: string }) {
  if (!status) return <span style={{ color: 'var(--estate-text-muted)' }}>—</span>;
  return <Tag tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Tag>;
}

function SubHead({ title, meta, right }: { title: string; meta?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '26px 0 10px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h4 style={{ ...type['code-inline'], fontWeight: 600, color: 'var(--estate-ink)', margin: 0 }}>{title}</h4>
        {meta && <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{meta}</span>}
      </div>
      {right}
    </div>
  );
}

const TH: React.CSSProperties = {
  ...type.eyebrow,
  textTransform: 'none',
  fontFamily: 'var(--font-mono)',
  color: 'var(--estate-text-muted)',
  textAlign: 'left',
  padding: '8px 12px',
  background: 'var(--estate-th-bg, var(--estate-bg))',
  borderBottom: '1px solid var(--estate-border)',
  whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = {
  ...type.ui,
  padding: '9px 12px',
  borderBottom: '1px solid var(--estate-border)',
  verticalAlign: 'top',
  color: 'var(--estate-text-secondary)',
};

function TableShell({ children, minWidth }: { children: React.ReactNode; minWidth: number }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--estate-border)', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth }}>{children}</table>
    </div>
  );
}

// ── Column coverage ─────────────────────────────────────────────────────────
//
// Scales to wide tables: one proportional bar (dimension / measure / not
// referenced) instead of one segment per column, then the NOT referenced
// columns grouped by data_type family with what each family could become.
// Referenced columns sit in a collapsed list.

type TypeFamily = 'numeric' | 'temporal' | 'string' | 'boolean' | 'complex' | 'other';

const FAMILY_META: Record<TypeFamily, { label: string; hint: string }> = {
  numeric:  { label: 'numeric',  hint: 'possible measures' },
  temporal: { label: 'temporal', hint: 'possible temporal dimensions' },
  string:   { label: 'string',   hint: 'possible categorical / attribute dimensions' },
  boolean:  { label: 'boolean',  hint: 'possible flags / categorical dimensions' },
  complex:  { label: 'complex',  hint: 'array / map / struct — flatten before modelling' },
  other:    { label: 'other',    hint: '' },
};
const FAMILY_ORDER: TypeFamily[] = ['numeric', 'temporal', 'string', 'boolean', 'complex', 'other'];
const CHIPS_PER_GROUP = 12;

function familyOf(dataType: string | null): TypeFamily {
  const dt = (dataType ?? '').toLowerCase();
  if (/^(array|map|struct)|<|variant/.test(dt)) return 'complex';
  if (/boolean|^bool$/.test(dt)) return 'boolean';
  if (TEMPORAL_RE.test(dt)) return 'temporal';
  if (NUMERIC_RE.test(dt)) return 'numeric';
  if (/string|varchar|char|text/.test(dt)) return 'string';
  return 'other';
}

function colTitle(c: TableColumn): string {
  const distinct = Number(c.profile?.distinct_est);
  const nullRate = Number(c.profile?.null_rate);
  return [
    `${c.name}`,
    `data_type: ${c.data_type ?? '?'}`,
    Number.isFinite(distinct) ? `distinct_est: ${distinct.toLocaleString()}` : null,
    Number.isFinite(nullRate) ? `null_rate: ${(nullRate * 100).toFixed(1)}%` : null,
    c.semantic?.role ? `role: ${c.semantic.role}` : null,
  ].filter(Boolean).join('\n');
}

function ColumnChip({ c, onColumnClick, marker }: { c: TableColumn; onColumnClick?: (n: string) => void; marker?: string }) {
  const style: React.CSSProperties = {
    ...type['code-inline'],
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 8px',
    borderRadius: 6,
    border: '1px solid var(--estate-border)',
    background: 'var(--estate-raised)',
    color: 'var(--estate-ink)',
    whiteSpace: 'nowrap',
  };
  const inner = (
    <>
      {marker && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 2, background: marker }} />}
      {c.name}
    </>
  );
  return onColumnClick ? (
    <button type="button" onClick={() => onColumnClick(c.name)} title={colTitle(c)} className="transition-colors hover:bg-[var(--estate-active-bg)]" style={{ ...style, cursor: 'pointer' }}>
      {inner}
    </button>
  ) : (
    <span title={colTitle(c)} style={style}>{inner}</span>
  );
}

function ChipGroup({ items, onColumnClick, markerOf }: { items: TableColumn[]; onColumnClick?: (n: string) => void; markerOf?: (c: TableColumn) => string | undefined }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, CHIPS_PER_GROUP);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {shown.map((c) => <ColumnChip key={c.name} c={c} onColumnClick={onColumnClick} marker={markerOf?.(c)} />)}
      {items.length > CHIPS_PER_GROUP && (
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...type.caption, color: 'var(--brand-a-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}>
          {open ? 'less' : `+${items.length - CHIPS_PER_GROUP} more`}
        </button>
      )}
    </div>
  );
}

function ColumnCoverage({ columns, dimCols, measureCols, onColumnClick }: {
  columns: TableColumn[];
  dimCols: Set<string>;
  measureCols: Set<string>;
  onColumnClick?: (n: string) => void;
}) {
  const DIM = 'var(--brand-a)';
  const MEAS = TONE_COLOR.violet;

  const asDim = columns.filter((c) => dimCols.has(c.name.toLowerCase()));
  const asMeasure = columns.filter((c) => !dimCols.has(c.name.toLowerCase()) && measureCols.has(c.name.toLowerCase()));
  const unreferenced = columns.filter((c) => !dimCols.has(c.name.toLowerCase()) && !measureCols.has(c.name.toLowerCase()));
  const total = columns.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const byFamily = new Map<TypeFamily, TableColumn[]>();
  for (const c of unreferenced) {
    const f = familyOf(c.data_type);
    byFamily.set(f, [...(byFamily.get(f) ?? []), c]);
  }

  const segments = [
    { key: 'dimension', label: 'dimension', n: asDim.length, color: DIM },
    { key: 'measure', label: 'measure', n: asMeasure.length, color: MEAS },
    { key: 'none', label: 'not referenced', n: unreferenced.length, color: 'var(--estate-active-bg)' },
  ];

  return (
    <>
      <SubHead
        title="column coverage"
        meta={`${asDim.length + asMeasure.length} of ${total} columns referenced (${pct(asDim.length + asMeasure.length)}%)`}
      />

      {/* Proportional bar — same readability at 16 or 500 columns */}
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', gap: 2, background: 'var(--estate-bg)' }} aria-hidden="true">
        {segments.filter((s) => s.n > 0).map((s) => (
          <div key={s.key} style={{ flex: s.n, background: s.color, minWidth: 6, border: s.key === 'none' ? '1px solid var(--estate-border)' : undefined, borderRadius: 999 }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', marginTop: 8 }}>
        {segments.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...type.caption, color: 'var(--estate-text-secondary)' }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: s.color, border: s.key === 'none' ? '1px solid var(--estate-border)' : undefined }} />
            <code style={type['code-inline']}>{s.label}</code>
            <strong style={{ color: 'var(--estate-ink)' }}>{s.n}</strong>
            <span style={{ color: 'var(--estate-text-muted)' }}>{pct(s.n)}%</span>
          </span>
        ))}
      </div>

      {/* Not referenced, by data_type family */}
      {unreferenced.length > 0 && (
        <div style={{ marginTop: 16, border: '1px solid var(--estate-border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ ...type['code-inline'], fontWeight: 600, color: 'var(--estate-ink)', padding: '8px 12px', background: 'var(--estate-th-bg, var(--estate-bg))', borderBottom: '1px solid var(--estate-border)' }}>
            not referenced · {unreferenced.length}
          </div>
          {FAMILY_ORDER.filter((f) => byFamily.has(f)).map((f, i) => {
            const items = byFamily.get(f)!;
            return (
              <div
                key={f}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(150px, 210px) 1fr',
                  gap: 14,
                  padding: '10px 12px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--estate-border)',
                  alignItems: 'start',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ ...type['code-inline'], fontWeight: 600, color: 'var(--estate-ink)' }}>
                    {FAMILY_META[f].label} <span style={{ color: 'var(--estate-text-muted)', fontWeight: 400 }}>· {items.length}</span>
                  </span>
                  {FAMILY_META[f].hint && <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{FAMILY_META[f].hint}</span>}
                </div>
                <ChipGroup items={items} onColumnClick={onColumnClick} />
              </div>
            );
          })}
        </div>
      )}

      {/* Referenced (collapsed) */}
      {asDim.length + asMeasure.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ ...type.caption, color: 'var(--estate-text-secondary)', cursor: 'pointer' }}>
            referenced · {asDim.length + asMeasure.length}
          </summary>
          <div style={{ marginTop: 8 }}>
            <ChipGroup
              items={[...asDim, ...asMeasure]}
              onColumnClick={onColumnClick}
              markerOf={(c) => (dimCols.has(c.name.toLowerCase()) ? DIM : MEAS)}
            />
          </div>
        </details>
      )}
    </>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EntityModelCard({
  entity_id,
  entity_model_id,
  entity_label,
  description,
  status,
  dimensions,
  measures,
  fullPath = '',
  ai_context,
  synonyms = [],
  created_by,
  updated_at,
  model,
  joins = [],
  audit = [],
  columns = [],
  onColumnClick,
  onPromoted,
}: EntityModelCardProps) {
  const [promoting, setPromoting] = useState(false);
  const [localStatus, setLocalStatus] = useState(status);

  const handlePromote = async () => {
    if (!entity_model_id || promoting) return;
    setPromoting(true);
    try {
      const res = await fetch(`/api/inspector/semantic/${entity_model_id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityIds: [entity_id] }),
      });
      if (res.ok) {
        setLocalStatus('governed');
        toast.success('Entity promoted to governed');
        onPromoted?.();
      } else {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? 'Failed to promote entity');
      }
    } catch {
      toast.error('Failed to promote entity');
    } finally {
      setPromoting(false);
    }
  };

  const colByName = useMemo(() => new Map(columns.map((c) => [c.name.toLowerCase(), c])), [columns]);
  const checks = useMemo(() => runChecks(dimensions, measures, columns), [dimensions, measures, columns]);
  const allChecks = [...checks.values()].flat();
  const errorCount = allChecks.filter((c) => c.severity === 'error').length;
  const sql = useMemo(() => (fullPath ? exampleSql(fullPath, dimensions, measures) : null), [fullPath, dimensions, measures]);

  const sortedDims = [...dimensions].sort((a, b) => {
    const ia = DIM_ORDER.indexOf(a.dimension_type);
    const ib = DIM_ORDER.indexOf(b.dimension_type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.dimension_label.localeCompare(b.dimension_label);
  });

  const orderedColumns = [...columns].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const referenced = new Set([
    ...dimensions.map((d) => d.column_name.toLowerCase()),
    ...measures.map((m) => m.column_name?.toLowerCase()).filter((c): c is string => !!c),
  ]);
  const referencedInTable = orderedColumns.filter((c) => referenced.has(c.name.toLowerCase())).length;

  const copySql = async () => {
    if (!sql) return;
    try { await navigator.clipboard.writeText(sql); toast.success('SQL copied'); } catch { toast.error('Could not copy'); }
  };

  return (
    <Card
      title="Entity Model (T4)"
      meta={model ? <>platform_semantic_models · <code style={type['code-inline']}>{model.name}</code> ({model.status})</> : undefined}
      actions={
        <>
          <Tag tone={STATUS_TONE[localStatus] ?? 'neutral'} dot>{localStatus}</Tag>
          {localStatus === 'candidate' && entity_model_id && (
            <button type="button" disabled={promoting} onClick={handlePromote} className={BTN_PRIMARY} style={{ border: 'none', cursor: promoting ? 'not-allowed' : 'pointer' }}>
              {promoting ? 'Promoting…' : 'Promote to governed'}
            </button>
          )}
        </>
      }
    >
      {/* ── Entity ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 420px' }}>
          <span style={{ ...type['title-section'], color: 'var(--estate-ink)' }}>{entity_label}</span>
          {fullPath && <code style={{ ...type.code, color: 'var(--estate-text-muted)' }}>{fullPath}</code>}
          {description && <p style={{ ...type.ui, color: 'var(--estate-text-secondary)', margin: '4px 0 0', maxWidth: '90ch' }}>{description}</p>}
          {synonyms.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span style={{ ...type['code-inline'], color: 'var(--estate-text-muted)' }}>synonyms</span>
              {synonyms.map((s) => <Tag key={s} tone="neutral">{s}</Tag>)}
            </div>
          )}
        </div>
        {/* Key numbers */}
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '2px 22px', margin: 0, alignItems: 'baseline' }}>
          {[
            ['dimensions', dimensions.length],
            ['measures', measures.length],
            ['joins', joins.length],
            ['columns used', columns.length ? `${referencedInTable}/${columns.length}` : '—'],
          ].map(([k, v]) => (
            <div key={k as string} style={{ display: 'flex', flexDirection: 'column' }}>
              <dd style={{ ...type['kpi-md'], color: 'var(--estate-ink)', margin: 0 }}>{v}</dd>
              <dt style={{ ...type['code-inline'], color: 'var(--estate-text-muted)' }}>{k}</dt>
            </div>
          ))}
        </dl>
      </div>
      {(updated_at || created_by || entity_model_id) && (
        <div style={{ ...type.caption, color: 'var(--estate-text-muted)', marginTop: 10 }}>
          {[
            updated_at && <span key="u" title={fullTime(updated_at)}>updated_at {relTime(updated_at)}</span>,
            created_by && <span key="c">created_by {created_by}</span>,
            <span key="e">entity_id <code style={type['code-inline']}>{entity_id.slice(0, 8)}</code></span>,
          ].filter(Boolean).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])}
        </div>
      )}

      {/* ── Checks ── */}
      {columns.length > 0 && (
        <div
          style={{
            marginTop: 18,
            padding: '12px 14px',
            borderRadius: 10,
            border: `1px solid ${allChecks.length === 0 ? 'var(--estate-border)' : `color-mix(in srgb, ${errorCount ? TONE_COLOR.red : TONE_COLOR.amber} 30%, transparent)`}`,
            background: allChecks.length === 0 ? 'var(--estate-bg)' : `color-mix(in srgb, ${errorCount ? TONE_COLOR.red : TONE_COLOR.amber} 6%, transparent)`,
          }}
        >
          <div style={{ ...type.ui, fontWeight: 600, color: 'var(--estate-ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: allChecks.length === 0 ? TONE_COLOR.green : errorCount ? TONE_COLOR.red : TONE_COLOR.amber }} />
            Model checks
            <span style={{ ...type.caption, fontWeight: 400, color: 'var(--estate-text-muted)' }}>
              {allChecks.length === 0 ? 'every measure and dimension matches its column' : `${errorCount} error${errorCount === 1 ? '' : 's'} · ${allChecks.length - errorCount} warning${allChecks.length - errorCount === 1 ? '' : 's'}`}
            </span>
          </div>
          {allChecks.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {allChecks.map((c, i) => (
                <li key={i} style={{ ...type.ui, color: 'var(--estate-text-secondary)', display: 'flex', gap: 8 }}>
                  <span style={{ ...type['code-inline'], fontWeight: 600, color: c.severity === 'error' ? TONE_COLOR.red : TONE_COLOR.amber, flexShrink: 0 }}>
                    {c.severity}
                  </span>
                  <span><strong style={{ color: 'var(--estate-ink)', fontWeight: 600 }}>{c.target}</strong> — {c.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Example SQL ── */}
      {sql && (
        <>
          <SubHead
            title="example_sql"
            meta="generated from this model"
            right={<button type="button" onClick={copySql} className={BTN_SECONDARY}>Copy SQL</button>}
          />
          <CodeBlock code={sql} maxHeight={220} />
        </>
      )}

      {/* ── Measures ── */}
      <SubHead title="measures" meta={`${measures.length} · platform_sem_measures`} />
      {measures.length === 0 ? (
        <EmptyNote>No measures.</EmptyNote>
      ) : (
        <TableShell minWidth={820}>
          <thead>
            <tr>
              <th style={TH}>measure_label</th>
              <th style={TH}>definition</th>
              <th style={TH}>metric_type</th>
              <th style={TH}>data_type</th>
              <th style={TH}>unit · format</th>
              <th style={TH}>status</th>
              <th style={TH}>checks</th>
            </tr>
          </thead>
          <tbody>
            {measures.map((m) => {
              const col = m.column_name ? colByName.get(m.column_name.toLowerCase()) : undefined;
              const agg = m.aggregate.toLowerCase() === 'count_distinct' ? 'COUNT(DISTINCT ' : `${m.aggregate.toUpperCase()}(`;
              return (
                <tr key={m.measure_label} title={[m.description, m.nl_intent && `nl_intent: ${m.nl_intent}`, m.synonyms?.length ? `synonyms: ${m.synonyms.join(', ')}` : null].filter(Boolean).join('\n') || undefined}>
                  <td style={{ ...TD, color: 'var(--estate-ink)', fontWeight: 600 }}>{m.measure_label}</td>
                  <td style={TD}>
                    {m.expression ? (
                      <code style={{ ...type['code-inline'], color: 'var(--estate-ink)' }}>{m.expression}</code>
                    ) : (
                      <span style={{ ...type['code-inline'] }}>
                        <span style={{ color: 'var(--brand-a-ink)', fontWeight: 600 }}>{agg}</span>
                        {m.column_name ? <ColumnRef name={m.column_name} onClick={onColumnClick} /> : '*'})
                      </span>
                    )}
                  </td>
                  <td style={TD}><code style={type['code-inline']}>{m.metric_type ?? '—'}</code></td>
                  <td style={TD}><code style={type['code-inline']}>{col?.data_type ?? '—'}</code></td>
                  <td style={TD}>{[m.unit, m.format_hint].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={TD}><StatusCell status={m.status} /></td>
                  <td style={TD}><CheckDot checks={checks.get(`m:${m.measure_label}`)} /></td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      {/* ── Dimensions ── */}
      <SubHead title="dimensions" meta={`${dimensions.length} · platform_sem_dimensions`} />
      {dimensions.length === 0 ? (
        <EmptyNote>No dimensions.</EmptyNote>
      ) : (
        <TableShell minWidth={900}>
          <thead>
            <tr>
              <th style={TH}>dimension_label</th>
              <th style={TH}>column_name</th>
              <th style={TH}>data_type</th>
              <th style={{ ...TH, textAlign: 'right' }}>distinct_est</th>
              <th style={{ ...TH, textAlign: 'right' }}>null_rate</th>
              <th style={TH}>synonyms</th>
              <th style={TH}>status</th>
              <th style={TH}>checks</th>
            </tr>
          </thead>
          <tbody>
            {sortedDims.map((d, i) => {
              const col = colByName.get(d.column_name.toLowerCase());
              const distinct = Number(col?.profile?.distinct_est);
              const nullRate = Number(col?.profile?.null_rate);
              const newGroup = i === 0 || sortedDims[i - 1].dimension_type !== d.dimension_type;
              return (
                <React.Fragment key={d.column_name}>
                  {newGroup && (
                    <tr>
                      <td colSpan={8} style={{ ...TD, background: 'var(--estate-bg)', padding: '6px 12px' }}>
                        <code style={{ ...type['code-inline'], fontWeight: 600, color: 'var(--estate-ink)' }}>dimension_type = {d.dimension_type}</code>
                        <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}> · {sortedDims.filter((x) => x.dimension_type === d.dimension_type).length}</span>
                      </td>
                    </tr>
                  )}
                  <tr title={[d.description, d.nl_intent && `nl_intent: ${d.nl_intent}`, d.format_hint && `format_hint: ${d.format_hint}`].filter(Boolean).join('\n') || undefined}>
                    <td style={{ ...TD, color: 'var(--estate-ink)', fontWeight: 600 }}>{d.dimension_label}</td>
                    <td style={TD}><ColumnRef name={d.column_name} onClick={onColumnClick} /></td>
                    <td style={TD}><code style={type['code-inline']}>{col?.data_type ?? '—'}</code></td>
                    <td style={{ ...TD, textAlign: 'right' }}><code style={type['code-inline']}>{Number.isFinite(distinct) ? distinct.toLocaleString() : '—'}</code></td>
                    <td style={{ ...TD, textAlign: 'right' }}><code style={type['code-inline']}>{Number.isFinite(nullRate) ? `${(nullRate * 100).toFixed(1)}%` : '—'}</code></td>
                    <td style={TD}>{d.synonyms?.length ? d.synonyms.join(', ') : '—'}</td>
                    <td style={TD}><StatusCell status={d.status} /></td>
                    <td style={TD}><CheckDot checks={checks.get(`d:${d.column_name}`)} /></td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </TableShell>
      )}

      {/* ── Joins ── */}
      <SubHead title="joins" meta={`${joins.length} · platform_sem_joins`} />
      {joins.length === 0 ? (
        <EmptyNote>No joins defined for this entity.</EmptyNote>
      ) : (
        <TableShell minWidth={760}>
          <thead>
            <tr>
              <th style={TH}>direction</th>
              <th style={TH}>entity</th>
              <th style={TH}>join_type</th>
              <th style={TH}>join_on_sql</th>
            </tr>
          </thead>
          <tbody>
            {joins.map((j) => (
              <tr key={j.id} title={j.description ?? undefined}>
                <td style={TD}><code style={type['code-inline']}>{j.direction === 'out' ? 'this → other' : 'other → this'}</code></td>
                <td style={TD}>
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ color: 'var(--estate-ink)', fontWeight: 600 }}>{j.other.entity_label}</span>
                    <code style={{ ...type['code-inline'], color: 'var(--estate-text-muted)' }}>{j.other.full_path}</code>
                  </span>
                </td>
                <td style={TD}><code style={type['code-inline']}>{j.join_type}</code></td>
                <td style={TD}><code style={{ ...type['code-inline'], color: 'var(--estate-ink)', overflowWrap: 'anywhere' }}>{j.join_on_sql}</code></td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {/* ── Coverage ── */}
      {orderedColumns.length > 0 && (
        <ColumnCoverage
          columns={orderedColumns}
          dimCols={new Set(dimensions.map((d) => d.column_name.toLowerCase()))}
          measureCols={new Set(measures.map((m) => m.column_name?.toLowerCase()).filter((c): c is string => !!c))}
          onColumnClick={onColumnClick}
        />
      )}

      {/* ── ai_context ── */}
      {ai_context && (
        <details style={{ marginTop: 22 }}>
          <summary style={{ ...type['code-inline'], fontWeight: 600, color: 'var(--estate-ink)', cursor: 'pointer' }}>ai_context</summary>
          <div style={{ marginTop: 8 }}><CodeBlock code={ai_context} maxHeight={240} /></div>
        </details>
      )}

      {/* ── Audit ── */}
      {audit.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary style={{ ...type['code-inline'], fontWeight: 600, color: 'var(--estate-ink)', cursor: 'pointer' }}>
            platform_sem_audit <span style={{ ...type.caption, fontWeight: 400, color: 'var(--estate-text-muted)' }}>· last {audit.length}</span>
          </summary>
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {audit.map((a, i) => (
              <li key={i} style={{ ...type.ui, color: 'var(--estate-text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span title={fullTime(a.created_at)} style={{ color: 'var(--estate-text-muted)', minWidth: 72 }}>{relTime(a.created_at)}</span>
                <code style={type['code-inline']}>{a.table_name}</code>
                <span>{a.action}{a.from_status || a.to_status ? <> <code style={type['code-inline']}>{a.from_status ?? '∅'} → {a.to_status ?? '∅'}</code></> : null}</span>
                <span style={{ color: 'var(--estate-text-muted)' }}>by {a.changed_by}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
