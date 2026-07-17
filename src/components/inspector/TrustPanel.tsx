'use client';

import React, { useState } from 'react';
import { Copy, Check, ChevronRight } from 'lucide-react';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

const MUTED = '#8892A4';
const GOLD = '#FDB515';

export interface TrustPanelProps {
  /** Compiled SQL — surfaced read-only. Required (it is the heart of the panel). */
  sql: string;
  /**
   * IDs of the governed definitions the query actually referenced. Rendered as
   * "label (id)" when a label is resolvable via resolvedLabels, else just the id.
   */
  definitionsUsed?: { dimensions: string[]; measures: string[] };
  /** Rows returned by the query. Omitted in "SQL preview" mode (pre-execution). */
  rowCount?: number;
  /** ISO timestamp of execution. Omitted in "SQL preview" mode. */
  executedAt?: string;
  /** Optional id → human label map for the definitions list. */
  resolvedLabels?: Record<string, string>;
  /** Start expanded. Default false — most users want the chart, not the SQL. */
  defaultOpen?: boolean;
  /** Summary text on the collapse toggle. Default "How this was computed". */
  summaryLabel?: string;
  /** Extra styles merged onto the outer container. */
  style?: React.CSSProperties;
  /**
   * Phase 3.5C — when true, this is a raw-SQL escape-hatch chart. Instead of
   * "Semantic definitions used", the panel states it is NOT governed and NOT
   * drift-checked, then shows the raw SQL itself (there is no compiled semantic
   * query — `sql` IS the stored SQL).
   */
  rawSql?: boolean;
}

/**
 * The Trust Spine transparency panel. Renders the path from a user's question
 * to the rendered number: which governed definitions were used, the compiled
 * SQL, the row count, and the execution time. Collapsed by default.
 *
 * Shared by the Inspector chat (SemanticChartCard) and the dashboard viewer /
 * builder widget renderer — the two surfaces pass the same shape, sourced
 * respectively from the semantic_chart_result SSE event and the widget-data
 * route's WidgetDataResult.
 */
export function TrustPanel({
  sql,
  definitionsUsed,
  rowCount,
  executedAt,
  resolvedLabels,
  defaultOpen = false,
  summaryLabel = 'How this was computed',
  style,
  rawSql = false,
}: TrustPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  const renderDefs = (ids: string[]) =>
    ids
      .map((id) => {
        const label = resolvedLabels?.[id];
        return label ? `${label} (${id})` : id;
      })
      .join(', ');

  const dims = definitionsUsed?.dimensions ?? [];
  const measures = definitionsUsed?.measures ?? [];

  return (
    <details
      style={{
        ...MONO,
        border: '1px solid rgba(74,96,128,0.25)',
        borderRadius: 4,
        background: 'rgba(0,0,0,0.15)',
        ...style,
      }}
    >
      <summary
        style={{
          fontSize: 9,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: MUTED,
          cursor: 'pointer',
          userSelect: 'none',
          padding: '6px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          listStyle: 'none',
        }}
      >
        <ChevronRight size={11} className="trust-chevron" style={{ transition: 'transform 0.15s', flexShrink: 0 }} />
        {summaryLabel}
      </summary>

      <div style={{ padding: '2px 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Raw-SQL governance notice (Phase 3.5C) — replaces the definitions block */}
        {rawSql && (
          <div style={{ fontSize: 10, color: GOLD, lineHeight: 1.5 }}>
            Raw SQL — not governed, not drift-checked.
          </div>
        )}

        {/* Semantic definitions used */}
        {!rawSql && (dims.length > 0 || measures.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TrustLabel text="Semantic definitions used" />
            {dims.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)' }}>
                <span style={{ color: MUTED }}>Dimensions: </span>
                {renderDefs(dims)}
              </div>
            )}
            {measures.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)' }}>
                <span style={{ color: MUTED }}>Measures: </span>
                {renderDefs(measures)}
              </div>
            )}
          </div>
        )}

        {/* Row count + timestamp */}
        {(typeof rowCount === 'number' || executedAt) && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {typeof rowCount === 'number' && (
              <span style={{ fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)' }}>
                <span style={{ color: MUTED }}>Rows: </span>
                {rowCount.toLocaleString()}
              </span>
            )}
            {executedAt && (
              <span style={{ fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)' }}>
                <span style={{ color: MUTED }}>Executed: </span>
                {formatTimestamp(executedAt)}
              </span>
            )}
          </div>
        )}

        {/* Compiled SQL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <TrustLabel text="Compiled SQL" />
            <button
              onClick={handleCopy}
              title="Copy SQL to clipboard"
              style={{
                ...MONO,
                fontSize: 9,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                border: '1px solid rgba(74,96,128,0.35)',
                borderRadius: 3,
                padding: '2px 7px',
                background: 'transparent',
                color: copied ? '#86EFAC' : GOLD,
              }}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre
            style={{
              ...MONO,
              fontSize: 10,
              color: 'var(--wb-ink-dim, #B8C1CF)',
              overflowX: 'auto',
              margin: 0,
              padding: '8px',
              background: 'rgba(0,0,0,0.25)',
              borderRadius: 3,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 260,
            }}
          >
            <code>{sql}</code>
          </pre>
        </div>
      </div>

      <style>{`
        details > summary::-webkit-details-marker { display: none; }
        details[open] .trust-chevron { transform: rotate(90deg); }
      `}</style>
    </details>
  );
}

function TrustLabel({ text }: { text: string }) {
  return (
    <span
      style={{
        ...MONO,
        fontSize: 9,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: MUTED,
      }}
    >
      {text}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}
