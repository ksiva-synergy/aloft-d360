'use client';

// EntityModelCard — T4 entity model (dimensions + measures) extracted from inline JSX.
//
// Unified card system: uses --estate-raised/--estate-border-gold wrapper (NOT pink #F472B6).
// Tier chip: "T4" in IBM Plex Mono, 9px, ink background, white text.
// Status chip uses trust palette (candidate = muted gray, governed = confirmed blue).
//
// Promote action wires to existing POST /api/inspector/semantic/[modelId]/promote.
// The entity_id and entity_model_id come from the semanticModel prop (sourced from
// reads.ts getObjectAggregate, which now returns them as entity_id / entity_model_id).

import React, { useState } from 'react';
import { toast } from 'sonner';

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
  onPromoted?: () => void;
}

const DIM_TYPE_STYLES: Record<string, React.CSSProperties> = {
  temporal:    { color: '#2F6DB0', borderColor: 'rgba(47,109,176,0.35)', background: 'transparent' },
  identifier:  { color: '#3B7A4B', borderColor: 'rgba(59,122,75,0.35)',  background: 'transparent' },
  categorical: { color: '#B4801A', borderColor: 'rgba(180,128,26,0.35)', background: 'transparent' },
  attribute:   { color: '#8a8271', borderColor: 'rgba(138,130,113,0.4)', background: 'transparent' },
};

const STATUS_CHIP: Record<string, React.CSSProperties> = {
  candidate: { background: 'rgba(138,130,113,.16)', color: '#8a8271',  border: '1px solid rgba(138,130,113,.4)' },
  governed:  { background: 'rgba(47,109,176,.14)',  color: '#2F6DB0',  border: '1px solid rgba(47,109,176,.4)' },
  proposed:  { background: 'rgba(47,109,176,.14)',  color: '#2F6DB0',  border: '1px solid rgba(47,109,176,.4)' },
  certified: { background: 'rgba(59,122,75,.15)',   color: '#3B7A4B',  border: '1px solid rgba(59,122,75,.4)' },
};

export default function EntityModelCard({
  entity_id,
  entity_model_id,
  entity_label,
  description,
  status,
  dimensions,
  measures,
  onPromoted,
}: EntityModelCardProps) {
  const [promoting, setPromoting] = useState(false);
  const [localStatus, setLocalStatus] = useState(status);

  const inkColor = 'var(--estate-ink)';
  const mutedColor = 'var(--estate-text-muted)';

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

  const chipStyle = STATUS_CHIP[localStatus] ?? STATUS_CHIP.candidate;

  return (
    <div
      style={{
        background: 'var(--estate-raised)',
        border: '1px solid var(--estate-border-gold)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '13px 18px',
          borderBottom: '1px solid var(--estate-border)',
          background: 'var(--estate-hover, rgba(0,0,0,0.02))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* T4 tier chip — unified card system, ink bg / white text */}
          <span
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 9,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 3,
              background: 'var(--estate-ink, #003262)',
              color: '#fff',
              letterSpacing: '0.04em',
            }}
          >
            T4
          </span>
          <span
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--estate-text-secondary)',
            }}
          >
            Entity Model
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Status chip */}
          <span
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 9,
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 3,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              ...chipStyle,
            }}
          >
            {localStatus}
          </span>

          {/* Promote button — only for candidate, only when model_id is available */}
          {localStatus === 'candidate' && entity_model_id && (
            <button
              type="button"
              disabled={promoting}
              onClick={handlePromote}
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '3px 10px',
                borderRadius: 3,
                border: '1px solid rgba(253,181,21,0.35)',
                background: 'transparent',
                color: promoting ? 'rgba(253,181,21,0.4)' : '#FDB515',
                cursor: promoting ? 'not-allowed' : 'pointer',
                transition: 'all 0.12s ease',
              }}
            >
              {promoting ? 'Promoting…' : 'Promote to governed'}
            </button>
          )}
        </div>
      </div>

      {/* Card body */}
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Entity name + description */}
        <div>
          <div
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 15,
              fontWeight: 600,
              color: inkColor,
            }}
          >
            {entity_label}
          </div>
          {description && (
            <div
              style={{
                marginTop: 4,
                fontFamily: '"Inter Tight", sans-serif',
                fontSize: 12,
                color: mutedColor,
                lineHeight: 1.5,
              }}
            >
              {description}
            </div>
          )}
        </div>

        {/* Dimensions + Measures grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Dimensions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--estate-text-secondary)',
              }}
            >
              Dimensions ({dimensions.length})
            </div>
            {dimensions.length === 0 ? (
              <div style={{ fontStyle: 'italic', fontSize: 11, color: mutedColor }}>None proposed.</div>
            ) : (
              dimensions.map((d) => {
                const typeStyle = DIM_TYPE_STYLES[d.dimension_type] ?? DIM_TYPE_STYLES.attribute;
                return (
                  <div key={d.column_name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        padding: '2px 5px',
                        borderRadius: 3,
                        border: `1px solid ${typeStyle.borderColor}`,
                        ...typeStyle,
                      }}
                    >
                      {d.dimension_type}
                    </span>
                    <div>
                      <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, color: inkColor }}>
                        {d.dimension_label}
                      </span>
                      <span style={{ fontFamily: '"IBM Plex Mono", monospace', marginLeft: 6, color: mutedColor }}>
                        ({d.column_name})
                      </span>
                      {d.description && (
                        <div style={{ marginTop: 2, color: mutedColor, fontFamily: '"Inter Tight", sans-serif', fontSize: 11 }}>
                          {d.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Measures */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--estate-text-secondary)',
              }}
            >
              Measures ({measures.length})
            </div>
            {measures.length === 0 ? (
              <div style={{ fontStyle: 'italic', fontSize: 11, color: mutedColor }}>None proposed.</div>
            ) : (
              measures.map((m) => (
                <div key={m.measure_label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
                  <span
                    style={{
                      flexShrink: 0,
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      padding: '2px 5px',
                      borderRadius: 3,
                      border: '1px solid rgba(251,146,60,0.3)',
                      color: '#FB923C',
                      background: 'transparent',
                    }}
                  >
                    {m.aggregate}
                  </span>
                  <div>
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, color: inkColor }}>
                      {m.measure_label}
                    </span>
                    {m.column_name && (
                      <span style={{ fontFamily: '"IBM Plex Mono", monospace', marginLeft: 6, color: mutedColor }}>
                        ({m.column_name})
                      </span>
                    )}
                    {m.unit && (
                      <span style={{ fontFamily: '"IBM Plex Mono", monospace', marginLeft: 4, color: '#B4801A' }}>
                        [{m.unit}]
                      </span>
                    )}
                    {m.description && (
                      <div style={{ marginTop: 2, color: mutedColor, fontFamily: '"Inter Tight", sans-serif', fontSize: 11 }}>
                        {m.description}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
