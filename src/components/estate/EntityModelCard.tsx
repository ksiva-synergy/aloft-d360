'use client';

// EntityModelCard — T4 entity model for this table, drawn as a small star
// diagram: dimensions (grouped by dimension_type) on the left, the entity hub
// in the middle, measures (aggregate(column_name)) on the right, each item
// wired to the hub. The hub carries status, counts, column coverage and the
// promote action. Stacks to one column on narrow screens.
//
// Promote action wires to existing POST /api/inspector/semantic/[modelId]/promote.
// The entity_id and entity_model_id come from the semanticModel prop (sourced from
// reads.ts getObjectAggregate).

import React, { useState } from 'react';
import { toast } from 'sonner';
import { type } from '@/lib/typography/tokens';
import { Card, Tag, BTN_PRIMARY, EmptyNote, TONE_COLOR, toneStyles, type Tone } from './object-ui';

interface Dimension {
  column_name: string;
  dimension_label: string;
  dimension_type: string;
  description: string | null;
}

interface Measure {
  column_name: string | null;
  measure_label: string;
  aggregate: string;
  description: string | null;
  unit: string | null;
}

interface EntityModelCardProps {
  entity_id: string;
  entity_model_id: string | null;
  entity_label: string;
  description: string | null;
  status: string;
  dimensions: Dimension[];
  measures: Measure[];
  /** Total active columns on the table — for the coverage bar. */
  totalColumns?: number;
  /** Jump to a column in the columns table. */
  onColumnClick?: (name: string) => void;
  onPromoted?: () => void;
}

const DIM_TONE: Record<string, Tone> = {
  temporal: 'blue',
  identifier: 'green',
  categorical: 'amber',
  attribute: 'neutral',
};
const DIM_ORDER = ['identifier', 'temporal', 'categorical', 'attribute'];

const STATUS: Record<string, { tone: Tone; label: string; title: string }> = {
  candidate: { tone: 'amber', label: 'candidate', title: 'Proposed by T4 — unverified until promoted to governed' },
  proposed:  { tone: 'amber', label: 'proposed',  title: 'Proposed by T4 — unverified until promoted to governed' },
  governed:  { tone: 'green', label: 'governed',  title: 'Governed definition' },
  certified: { tone: 'green', label: 'certified', title: 'Certified definition' },
};

const VISIBLE = 8;
const WIRE = 'var(--estate-border)';

// ── Pieces ───────────────────────────────────────────────────────────────────

/** Short horizontal wire with a dot at the hub end. */
function Wire({ side, color }: { side: 'left' | 'right'; color: string }) {
  return (
    <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', flex: '0 0 28px', flexDirection: side === 'left' ? 'row' : 'row-reverse' }}>
      <span style={{ flex: 1, height: 1.5, background: WIRE }} />
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, flexShrink: 0 }} />
    </span>
  );
}

function ColumnRef({ name, onClick }: { name: string; onClick?: (n: string) => void }) {
  return onClick ? (
    <button
      type="button"
      onClick={() => onClick(name)}
      title={`Show ${name} in the columns table`}
      className="hover:underline"
      style={{ ...type['code-inline'], color: 'var(--estate-text-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
    >
      {name}
    </button>
  ) : (
    <code style={{ ...type['code-inline'], color: 'var(--estate-text-muted)' }}>{name}</code>
  );
}

function ItemCard({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 12px',
        borderRadius: 10,
        background: 'var(--estate-raised)',
        border: '1px solid var(--estate-border)',
        boxShadow: `inset 3px 0 0 ${accent}`,
      }}
    >
      {children}
    </div>
  );
}

function ShowMore({ total, open, onToggle }: { total: number; open: boolean; onToggle: () => void }) {
  if (total <= VISIBLE) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{ ...type.ui, color: 'var(--brand-a-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textAlign: 'left' }}
    >
      {open ? 'Show fewer' : `Show all ${total}`}
    </button>
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
  totalColumns,
  onColumnClick,
  onPromoted,
}: EntityModelCardProps) {
  const [promoting, setPromoting] = useState(false);
  const [localStatus, setLocalStatus] = useState(status);
  const [allDims, setAllDims] = useState(false);
  const [allMeasures, setAllMeasures] = useState(false);

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

  const s = STATUS[localStatus] ?? { tone: 'neutral' as Tone, label: localStatus, title: localStatus };

  // Dimensions grouped by type, in a fixed order, then any unknown types.
  const sortedDims = [...dimensions].sort((a, b) => {
    const ia = DIM_ORDER.indexOf(a.dimension_type);
    const ib = DIM_ORDER.indexOf(b.dimension_type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.dimension_label.localeCompare(b.dimension_label);
  });
  const shownDims = allDims ? sortedDims : sortedDims.slice(0, VISIBLE);
  const shownMeasures = allMeasures ? measures : measures.slice(0, VISIBLE);
  const typeCounts = sortedDims.reduce<Record<string, number>>((acc, d) => {
    acc[d.dimension_type] = (acc[d.dimension_type] ?? 0) + 1;
    return acc;
  }, {});

  const modelled = new Set([
    ...dimensions.map((d) => d.column_name.toLowerCase()),
    ...measures.map((m) => m.column_name?.toLowerCase()).filter((c): c is string => !!c),
  ]).size;
  const coverage = totalColumns && totalColumns > 0 ? Math.min(1, modelled / totalColumns) : null;

  const groupHeader = (t: string, i: number) =>
    i === 0 || shownDims[i - 1].dimension_type !== t ? (
      <div key={`h-${t}`} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: i === 0 ? '0 0 2px' : '8px 0 2px' }}>
        <Tag tone={DIM_TONE[t] ?? 'neutral'}>{t}</Tag>
        <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{typeCounts[t]}</span>
      </div>
    ) : null;

  return (
    <Card
      title="Entity Model (T4)"
      meta={entity_model_id ? <>model <code style={type['code-inline']}>{entity_model_id.slice(0, 8)}</code></> : undefined}
      actions={<Tag tone={s.tone} dot title={s.title}>{s.label}</Tag>}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: '20px 0',
          alignItems: 'center',
        }}
      >
        {/* ── Dimensions (left) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ ...type.eyebrow, color: 'var(--estate-text-muted)', marginBottom: 2 }}>
            Dimensions · {dimensions.length}
          </div>
          {dimensions.length === 0 ? (
            <EmptyNote>No dimensions proposed.</EmptyNote>
          ) : (
            <>
              {shownDims.map((d, i) => {
                const tone = DIM_TONE[d.dimension_type] ?? 'neutral';
                const accent = toneStyles(tone).solid;
                return (
                  <React.Fragment key={d.column_name}>
                    {groupHeader(d.dimension_type, i)}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <ItemCard accent={accent}>
                        <span style={{ ...type.ui, fontWeight: 600, color: 'var(--estate-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.description ?? d.dimension_label}>
                          {d.dimension_label}
                        </span>
                        <ColumnRef name={d.column_name} onClick={onColumnClick} />
                      </ItemCard>
                      <Wire side="left" color={accent} />
                    </div>
                  </React.Fragment>
                );
              })}
              <ShowMore total={dimensions.length} open={allDims} onToggle={() => setAllDims((v) => !v)} />
            </>
          )}
        </div>

        {/* ── Entity hub (centre) ── */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 4px' }}>
          <div
            style={{
              width: '100%',
              maxWidth: 300,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: 10,
              padding: '20px 18px',
              borderRadius: 16,
              background: 'color-mix(in srgb, var(--brand-a) 7%, var(--estate-raised))',
              border: '1.5px solid color-mix(in srgb, var(--brand-a) 45%, transparent)',
              boxShadow: '0 8px 24px color-mix(in srgb, var(--brand-a) 14%, transparent)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--brand-a)',
                color: '#fff',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
              </svg>
            </span>
            <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>entity</span>
            <span style={{ ...type['title-card'], color: 'var(--estate-ink)', overflowWrap: 'anywhere' }}>{entity_label}</span>
            {description && (
              <p className="line-clamp-3" title={description} style={{ ...type.caption, color: 'var(--estate-text-secondary)', margin: 0 }}>
                {description}
              </p>
            )}

            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...type['kpi-sm'], color: 'var(--estate-ink)' }}>{dimensions.length}</span>
                <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>dimensions</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...type['kpi-sm'], color: 'var(--estate-ink)' }}>{measures.length}</span>
                <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>measures</span>
              </span>
            </div>

            {coverage !== null && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }} title="Columns used by a dimension or measure">
                <div style={{ height: 6, borderRadius: 999, background: 'var(--estate-active-bg)', overflow: 'hidden' }}>
                  <div style={{ width: `${coverage * 100}%`, height: '100%', background: 'var(--brand-a)' }} />
                </div>
                <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>
                  {modelled} of {totalColumns} columns modelled ({Math.round(coverage * 100)}%)
                </span>
              </div>
            )}

            {localStatus === 'candidate' && entity_model_id && (
              <button type="button" disabled={promoting} onClick={handlePromote} className={BTN_PRIMARY} style={{ border: 'none', cursor: promoting ? 'not-allowed' : 'pointer' }}>
                {promoting ? 'Promoting…' : 'Promote to governed'}
              </button>
            )}
          </div>
        </div>

        {/* ── Measures (right) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ ...type.eyebrow, color: 'var(--estate-text-muted)', marginBottom: 2, textAlign: 'right' }}>
            Measures · {measures.length}
          </div>
          {measures.length === 0 ? (
            <EmptyNote>No measures proposed.</EmptyNote>
          ) : (
            <>
              {shownMeasures.map((m) => (
                <div key={m.measure_label} style={{ display: 'flex', alignItems: 'center' }}>
                  <Wire side="right" color={TONE_COLOR.violet} />
                  <ItemCard accent={TONE_COLOR.violet}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                      <span style={{ ...type.ui, fontWeight: 600, color: 'var(--estate-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={m.description ?? m.measure_label}>
                        {m.measure_label}
                      </span>
                      {m.unit && <span style={{ ...type.caption, color: 'var(--estate-text-muted)', flexShrink: 0 }}>unit: {m.unit}</span>}
                    </span>
                    <span style={{ ...type['code-inline'], color: 'var(--estate-text-muted)' }}>
                      <span style={{ color: inkViolet, fontWeight: 600 }}>{m.aggregate.toUpperCase()}</span>(
                      {m.column_name ? <ColumnRef name={m.column_name} onClick={onColumnClick} /> : '*'})
                    </span>
                  </ItemCard>
                </div>
              ))}
              <ShowMore total={measures.length} open={allMeasures} onToggle={() => setAllMeasures((v) => !v)} />
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

const inkViolet = `color-mix(in srgb, ${TONE_COLOR.violet} 70%, var(--ink-1))`;
