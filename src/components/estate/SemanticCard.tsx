'use client';

// SemanticCard — DS3a extended version.
//
// Changes from original:
// - Surfaces previously hidden fields: entity, time_columns, measures, json_blob_columns
// - Renders usage_patterns as intent label + formatted SQL (not stringified blobs)
// - Integrates TrustActionBar (inline confirm/certify)
// - PII banner: shows Resolve button, disabled with tooltip (endpoint ships in DS3c)
// - Unified card system: --estate-raised/--estate-border-gold wrapper + T2 tier chip
//   No gold/navy/pink per-tier background — tier indicated only by the T2 chip.

import React, { useState } from 'react';
import { toast } from 'sonner';
import TrustChip from './TrustChip';
import TrustActionBar from './TrustActionBar';

export interface SemanticCardData {
  summary?: string;
  grain?: string;
  key_columns?: string[];
  usage_patterns?: Array<string | { intent?: string; sql?: string; pattern?: string }>;
  caveats?: string[];
  pii_columns?: string[];
  /** DS3a: recovered hidden fields */
  entity?: string;
  time_columns?: string[];
  measures?: string[];
  json_blob_columns?: string[];
  /** DS3c: PII review annotation (added after resolve-pii endpoint ships) */
  _pii_review?: { resolution: string; reviewed_by: string; reviewed_at: string; version?: number } | null;
}

export interface SemanticCardProps {
  card: SemanticCardData | null;
  status: string;
  /** DS3a: id of the specific semantic card row — passed to TrustActionBar for version guard */
  semanticCardId?: string | null;
  /** DS3c: version number of the rendered card — used for resolve-pii version guard */
  semanticVersion?: number | null;
  objectId?: string;
  modelId?: string | null;
  promptVersion?: string | null;
  confidence?: number | null;
  onColumnClick?: (name: string) => void;
  /** DS3c: audit-derived PII resolution state per-column */
  piiResolutions?: Record<string, { resolution: string; reviewed_by: string; reviewed_at: string }>;
}

function renderUsagePattern(pat: string | { intent?: string; sql?: string; pattern?: string }, idx: number): React.ReactNode {
  const inkColor = 'var(--estate-ink)';
  const mutedColor = 'var(--estate-text-muted)';
  const innerBg = 'var(--estate-bg, var(--estate-hover))';

  if (typeof pat === 'string') {
    // Legacy string format — detect if it looks like SQL
    const trimmed = pat.trim();
    const looksLikeSql = /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|MERGE)\b/i.test(trimmed);
    return (
      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <pre
          style={{
            padding: '10px 12px',
            borderRadius: 4,
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11,
            overflowX: 'auto',
            borderLeft: '2px solid #FDB515',
            background: innerBg,
            color: inkColor,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <code>{trimmed}</code>
        </pre>
        {!looksLikeSql && (
          <div style={{ fontFamily: '"Inter Tight", sans-serif', fontSize: 11, color: mutedColor, paddingLeft: 4 }}>
            {trimmed}
          </div>
        )}
      </div>
    );
  }

  // Structured format { intent?, sql?, pattern? }
  const intent = pat.intent ?? pat.pattern ?? null;
  const sql = pat.sql ?? null;
  return (
    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {intent && (
        <div
          style={{
            fontFamily: '"Inter Tight", sans-serif',
            fontSize: 12,
            fontWeight: 500,
            color: inkColor,
            paddingLeft: 2,
          }}
        >
          {intent}
        </div>
      )}
      {sql && (
        <pre
          style={{
            padding: '10px 12px',
            borderRadius: 4,
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11,
            overflowX: 'auto',
            borderLeft: '2px solid #FDB515',
            background: innerBg,
            color: inkColor,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <code>{sql.trim()}</code>
        </pre>
      )}
    </div>
  );
}

export default function SemanticCard({
  card,
  status,
  semanticCardId,
  semanticVersion,
  objectId,
  modelId,
  promptVersion,
  confidence,
  onColumnClick,
  piiResolutions,
}: SemanticCardProps) {
  const [localStatus, setLocalStatus] = useState(status);
  const [localPiiResolutions, setLocalPiiResolutions] = useState<Record<string, { resolution: string; reviewed_by: string; reviewed_at: string }>>(piiResolutions ?? {});
  const [piiLoading, setPiiLoading] = useState(false);

  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const innerBg = 'var(--estate-bg, var(--estate-hover))';
  const borderColor = 'var(--estate-border-gold)';

  const hasContent = card && (
    card.summary ||
    card.grain ||
    (Array.isArray(card.key_columns) && card.key_columns.length > 0) ||
    (Array.isArray(card.usage_patterns) && card.usage_patterns.length > 0) ||
    (Array.isArray(card.caveats) && card.caveats.length > 0) ||
    (Array.isArray(card.pii_columns) && card.pii_columns.length > 0) ||
    card.entity ||
    (Array.isArray(card.time_columns) && card.time_columns.length > 0) ||
    (Array.isArray(card.measures) && card.measures.length > 0) ||
    (Array.isArray(card.json_blob_columns) && card.json_blob_columns.length > 0)
  );

  if (!hasContent) return null;

  return (
    <div
      style={{
        background: 'var(--estate-raised)',
        border: '1px solid var(--estate-border-gold)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Card header — T2 tier chip + title + TrustChip */}
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
          {/* T2 tier chip — unified card system */}
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
            T2
          </span>
          <span
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: labelColor,
            }}
          >
            Semantic Context
          </span>
        </div>
        <TrustChip status={localStatus as any} />
      </div>

      {/* Card body */}
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Summary */}
        {card.summary && (
          <p
            style={{
              fontFamily: '"Inter Tight", sans-serif',
              fontSize: 13,
              lineHeight: 1.6,
              color: inkColor,
              margin: 0,
            }}
          >
            {card.summary}
          </p>
        )}

        {/* Entity — recovered hidden field */}
        {card.entity && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: mutedColor,
              }}
            >
              Entity
            </div>
            <div
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 12,
                fontWeight: 600,
                color: inkColor,
              }}
            >
              {card.entity}
            </div>
          </div>
        )}

        {/* Grain + Key Columns */}
        {(card.grain || (Array.isArray(card.key_columns) && card.key_columns.length > 0)) && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              borderTop: `1px solid ${borderColor}`,
              paddingTop: 14,
            }}
          >
            {card.grain && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: mutedColor,
                  }}
                >
                  Grain
                </div>
                <div
                  style={{
                    fontFamily: '"Inter Tight", sans-serif',
                    fontSize: 12,
                    fontWeight: 600,
                    color: inkColor,
                  }}
                >
                  {card.grain}
                </div>
              </div>
            )}

            {Array.isArray(card.key_columns) && card.key_columns.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: mutedColor,
                  }}
                >
                  Key Columns
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {card.key_columns.map((col, idx) =>
                    onColumnClick ? (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => onColumnClick(col)}
                        style={{
                          fontFamily: '"IBM Plex Mono", monospace',
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 3,
                          border: `1px solid ${borderColor}`,
                          background: innerBg,
                          color: inkColor,
                          cursor: 'pointer',
                        }}
                      >
                        {col}
                      </button>
                    ) : (
                      <span
                        key={idx}
                        style={{
                          fontFamily: '"IBM Plex Mono", monospace',
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 3,
                          border: `1px solid ${borderColor}`,
                          background: innerBg,
                          color: inkColor,
                        }}
                      >
                        {col}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Recovered hidden fields: time_columns, measures, json_blob_columns */}
        {((Array.isArray(card.time_columns) && card.time_columns.length > 0) ||
          (Array.isArray(card.measures) && card.measures.length > 0) ||
          (Array.isArray(card.json_blob_columns) && card.json_blob_columns.length > 0)) && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              borderTop: `1px solid ${borderColor}`,
              paddingTop: 14,
            }}
          >
            {Array.isArray(card.time_columns) && card.time_columns.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: mutedColor,
                  }}
                >
                  Time Columns
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {card.time_columns.map((c, i) => (
                    <span
                      key={i}
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: 10,
                        padding: '2px 5px',
                        borderRadius: 3,
                        border: '1px solid rgba(47,109,176,0.3)',
                        color: '#2F6DB0',
                        background: 'transparent',
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(card.measures) && card.measures.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: mutedColor,
                  }}
                >
                  Measures
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {card.measures.map((m, i) => (
                    <span
                      key={i}
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: 10,
                        padding: '2px 5px',
                        borderRadius: 3,
                        border: '1px solid rgba(59,122,75,0.3)',
                        color: '#3B7A4B',
                        background: 'transparent',
                      }}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(card.json_blob_columns) && card.json_blob_columns.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: mutedColor,
                  }}
                >
                  JSON Blob Cols
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {card.json_blob_columns.map((c, i) => (
                    <span
                      key={i}
                      style={{
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: 10,
                        padding: '2px 5px',
                        borderRadius: 3,
                        border: '1px solid rgba(180,128,26,0.3)',
                        color: '#B4801A',
                        background: 'transparent',
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Usage Patterns — formatted SQL, not stringified blobs */}
        {card.usage_patterns && Array.isArray(card.usage_patterns) && card.usage_patterns.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              borderTop: `1px solid ${borderColor}`,
              paddingTop: 14,
            }}
          >
            <div
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: mutedColor,
              }}
            >
              Usage Patterns
            </div>
            {card.usage_patterns.map((pat, idx) => renderUsagePattern(pat, idx))}
          </div>
        )}

        {/* Caveats */}
        {Array.isArray(card.caveats) && card.caveats.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderTop: `1px solid ${borderColor}`,
              paddingTop: 14,
            }}
          >
            <div
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: mutedColor,
              }}
            >
              Caveats & Warnings
            </div>
            {card.caveats.map((cav, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 4,
                  background: 'rgba(180,128,26,0.05)',
                  border: '1px solid rgba(180,128,26,0.15)',
                }}
              >
                <span style={{ fontSize: 12, color: '#B4801A', flexShrink: 0 }}>⚠</span>
                <span
                  style={{
                    fontFamily: '"Inter Tight", sans-serif',
                    fontSize: 12,
                    color: '#B4801A',
                    lineHeight: 1.5,
                  }}
                >
                  {cav}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* PII banner — per-column resolution state + Resolve button (DS3c enabled) */}
        {Array.isArray(card.pii_columns) && card.pii_columns.length > 0 && (() => {
          const totalFlagged = card.pii_columns!.length;
          const resolvedColumns = card.pii_columns!.filter(c => localPiiResolutions[c]);
          const unresolvedColumns = card.pii_columns!.filter(c => !localPiiResolutions[c]);
          const allResolved = unresolvedColumns.length === 0;
          const partiallyResolved = resolvedColumns.length > 0 && !allResolved;

          const handleResolvePii = async () => {
            if (!objectId || !semanticCardId || semanticVersion == null || unresolvedColumns.length === 0) return;
            setPiiLoading(true);
            try {
              const res = await fetch(
                `/api/agent-lab/context/objects/${objectId}/resolve-pii`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    semanticId: semanticCardId,
                    version: semanticVersion,
                    resolution: 'acknowledged',
                    columns: unresolvedColumns,
                  }),
                },
              );
              if (res.ok) {
                const now = new Date().toISOString();
                const newResolutions = { ...localPiiResolutions };
                for (const col of unresolvedColumns) {
                  newResolutions[col] = { resolution: 'acknowledged', reviewed_by: 'you', reviewed_at: now };
                }
                setLocalPiiResolutions(newResolutions);
                toast.success(`PII acknowledged for ${unresolvedColumns.length} column${unresolvedColumns.length !== 1 ? 's' : ''}`);
              } else {
                const json = await res.json().catch(() => ({}));
                if (json.error === 'VERSION_SUPERSEDED') {
                  toast.warning(
                    `A newer version of this card exists (v${json.latestVersion}). Refresh the page to review before resolving.`,
                    { duration: 8000 },
                  );
                } else {
                  toast.error(json.message || 'Failed to resolve PII');
                }
              }
            } catch {
              toast.error('Failed to resolve PII');
            } finally {
              setPiiLoading(false);
            }
          };

          return (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 4,
                background: allResolved ? 'rgba(59,122,75,0.05)' : 'rgba(178,58,50,0.05)',
                border: `1px solid ${allResolved ? 'rgba(59,122,75,0.2)' : 'rgba(178,58,50,0.2)'}`,
                borderTop: `1px solid ${borderColor}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, color: allResolved ? '#3B7A4B' : '#B23A32', flexShrink: 0 }}>⚑</span>
                <div>
                  <span
                    style={{
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: allResolved ? '#3B7A4B' : '#B23A32',
                      marginRight: 8,
                    }}
                  >
                    {allResolved
                      ? 'PII Resolved:'
                      : partiallyResolved
                        ? `PII (${resolvedColumns.length} of ${totalFlagged} resolved):`
                        : 'PII Detected:'}
                  </span>
                  <span
                    style={{
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: 11,
                      color: allResolved ? '#3B7A4B' : '#B23A32',
                    }}
                  >
                    {card.pii_columns!.map((col, i) => (
                      <span key={col}>
                        {i > 0 && ', '}
                        <span style={{ opacity: localPiiResolutions[col] ? 0.5 : 1, textDecoration: localPiiResolutions[col] ? 'line-through' : 'none' }}>
                          {col}
                        </span>
                      </span>
                    ))}
                  </span>
                </div>
              </div>

              {!allResolved && (
                <button
                  type="button"
                  disabled={piiLoading || !objectId || !semanticCardId || semanticVersion == null}
                  onClick={handleResolvePii}
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    padding: '3px 10px',
                    borderRadius: 3,
                    border: '1px solid rgba(178,58,50,0.4)',
                    background: 'transparent',
                    color: piiLoading ? 'rgba(178,58,50,0.4)' : '#B23A32',
                    cursor: piiLoading ? 'not-allowed' : 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {piiLoading ? 'Resolving…' : 'Resolve'}
                </button>
              )}
            </div>
          );
        })()}

        {/* Footer meta */}
        {(modelId || promptVersion || confidence) && (
          <div
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              paddingTop: 8,
              borderTop: `1px solid ${borderColor}`,
              color: mutedColor,
            }}
          >
            {modelId && <span>MODEL: {modelId}</span>}
            {modelId && promptVersion && <span>·</span>}
            {promptVersion && <span>PROMPT: {promptVersion}</span>}
            {(modelId || promptVersion) && confidence != null && <span>·</span>}
            {confidence != null && <span>CONFIDENCE: {Math.round(confidence * 100)}%</span>}
          </div>
        )}

        {/* TrustActionBar — inline confirm/certify, version-guarded */}
        {semanticCardId && objectId && (
          <TrustActionBar
            objectId={objectId}
            semanticCardId={semanticCardId}
            currentStatus={localStatus}
            onConfirmed={(s) => setLocalStatus(s)}
          />
        )}

      </div>
    </div>
  );
}
