'use client';

// SemanticCard — the T2 description of this table: summary, entity, grain,
// time columns, key columns, measures, JSON columns, caveats, PII, example
// queries, and the review trail (TrustActionBar).
//
// Card shape (from enrich.ts ObjectCardSchema): time_columns is
// { event, ingest } and json_blob_columns is { column: { observed_keys } };
// usage_patterns are { intent, sql_sketch }. Older cards stored arrays /
// { sql } — both shapes are read here (they were silently hidden before).

import React, { useState } from 'react';
import { toast } from 'sonner';
import TrustChip from './TrustChip';
import TrustActionBar from './TrustActionBar';
import { Card, CardBlock, Field, Tag, Callout, CodeBlock, BTN_SECONDARY } from './object-ui';
import { type } from '@/lib/typography/tokens';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';

type UsagePattern = string | { intent?: string; sql?: string; sql_sketch?: string; pattern?: string };

export interface SemanticCardData {
  summary?: string;
  grain?: string;
  key_columns?: string[];
  usage_patterns?: UsagePattern[];
  caveats?: string[];
  pii_columns?: string[];
  entity?: string;
  time_columns?: string[] | { event?: string | null; ingest?: string | null } | null;
  measures?: string[];
  json_blob_columns?: string[] | Record<string, { observed_keys?: string[] }> | null;
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

function timeColumns(tc: SemanticCardData['time_columns']): { label: string; column: string }[] {
  if (!tc) return [];
  if (Array.isArray(tc)) return tc.map((c) => ({ label: 'time_columns', column: c }));
  const out: { label: string; column: string }[] = [];
  if (tc.event) out.push({ label: 'time_columns.event', column: tc.event });
  if (tc.ingest) out.push({ label: 'time_columns.ingest', column: tc.ingest });
  return out;
}

function jsonColumns(j: SemanticCardData['json_blob_columns']): { column: string; keys: string[] }[] {
  if (!j) return [];
  if (Array.isArray(j)) return j.map((c) => ({ column: c, keys: [] }));
  return Object.entries(j).map(([column, v]) => ({ column, keys: Array.isArray(v?.observed_keys) ? v.observed_keys : [] }));
}

function normalisePattern(p: UsagePattern): { intent: string | null; sql: string | null } {
  if (typeof p === 'string') {
    const t = p.trim();
    const isSql = /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|MERGE)\b/i.test(t);
    return isSql ? { intent: null, sql: t } : { intent: t, sql: null };
  }
  return { intent: p.intent ?? p.pattern ?? null, sql: (p.sql_sketch ?? p.sql ?? null)?.trim() || null };
}

const PATTERNS_VISIBLE = 2;

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
  const canAct = useCanRunEstatePipeline();
  const [localStatus, setLocalStatus] = useState(status);
  const [localPiiResolutions, setLocalPiiResolutions] = useState<Record<string, { resolution: string; reviewed_by: string; reviewed_at: string }>>(piiResolutions ?? {});
  const [piiLoading, setPiiLoading] = useState(false);
  const [showAllPatterns, setShowAllPatterns] = useState(false);

  if (!card) return null;

  const keyCols = Array.isArray(card.key_columns) ? card.key_columns : [];
  const measures = Array.isArray(card.measures) ? card.measures : [];
  const caveats = Array.isArray(card.caveats) ? card.caveats : [];
  const piiCols = Array.isArray(card.pii_columns) ? card.pii_columns : [];
  const times = timeColumns(card.time_columns);
  const jsonCols = jsonColumns(card.json_blob_columns);
  const patterns = (Array.isArray(card.usage_patterns) ? card.usage_patterns : []).map(normalisePattern).filter((p) => p.intent || p.sql);

  const hasContent = card.summary || card.grain || card.entity || keyCols.length || measures.length
    || caveats.length || piiCols.length || times.length || jsonCols.length || patterns.length;
  if (!hasContent) return null;

  const colTag = (col: string, key: React.Key, tone: 'neutral' | 'blue' | 'violet' = 'neutral') => (
    <Tag key={key} tone={tone} mono onClick={onColumnClick ? () => onColumnClick(col) : undefined} title={onColumnClick ? `Show ${col} in the columns table` : undefined}>
      {col}
    </Tag>
  );

  // ── PII ──
  const resolvedPii = piiCols.filter((c) => localPiiResolutions[c]);
  const unresolvedPii = piiCols.filter((c) => !localPiiResolutions[c]);
  const allPiiResolved = piiCols.length > 0 && unresolvedPii.length === 0;

  const handleResolvePii = async () => {
    if (!objectId || !semanticCardId || semanticVersion == null || unresolvedPii.length === 0) return;
    setPiiLoading(true);
    try {
      const res = await fetch(`/api/agent-lab/context/objects/${objectId}/resolve-pii`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semanticId: semanticCardId,
          version: semanticVersion,
          resolution: 'acknowledged',
          columns: unresolvedPii,
        }),
      });
      if (res.ok) {
        const now = new Date().toISOString();
        const next = { ...localPiiResolutions };
        for (const col of unresolvedPii) next[col] = { resolution: 'acknowledged', reviewed_by: 'you', reviewed_at: now };
        setLocalPiiResolutions(next);
        toast.success(`PII acknowledged for ${unresolvedPii.length} column${unresolvedPii.length !== 1 ? 's' : ''}`);
      } else {
        const json = await res.json().catch(() => ({}));
        if (json.error === 'VERSION_SUPERSEDED') {
          toast.warning(`A newer version of this card exists (v${json.latestVersion}). Refresh the page to review before resolving.`, { duration: 8000 });
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

  const visiblePatterns = showAllPatterns ? patterns : patterns.slice(0, PATTERNS_VISIBLE);
  const metaParts = [
    'T2',
    confidence != null ? `${Math.round(confidence * 100)}% confidence` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Card
      title="Semantic Context"
      meta={metaParts}
      actions={<TrustChip status={localStatus as any} />}
    >
      {/* Summary */}
      {card.summary && (
        <p style={{ ...type['body-lg'], color: 'var(--estate-ink)', margin: 0, maxWidth: '85ch' }}>{card.summary}</p>
      )}

      {/* Key facts */}
      {(card.entity || card.grain || times.length > 0) && (
        <CardBlock first={!card.summary}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 18 }}>
            {card.entity && <Field label="Entity"><span style={{ fontWeight: 600 }}>{card.entity}</span></Field>}
            {card.grain && <Field label="Grain">{card.grain}</Field>}
            {times.map((t) => (
              <Field key={t.label + t.column} label={t.label}>{colTag(t.column, t.column, 'blue')}</Field>
            ))}
          </div>
        </CardBlock>
      )}

      {/* Columns that matter */}
      {(keyCols.length > 0 || measures.length > 0 || jsonCols.length > 0) && (
        <CardBlock>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 18 }}>
            {keyCols.length > 0 && (
              <Field label="Key columns">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{keyCols.map((c, i) => colTag(c, i))}</div>
              </Field>
            )}
            {measures.length > 0 && (
              <Field label="Measures">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{measures.map((c, i) => colTag(c, i, 'violet'))}</div>
              </Field>
            )}
            {jsonCols.length > 0 && (
              <Field label="JSON blob columns">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {jsonCols.map((j) => (
                    <span key={j.column} title={j.keys.length ? `observed_keys: ${j.keys.join(', ')}` : undefined}>
                      {colTag(j.column, j.column)}
                    </span>
                  ))}
                </div>
              </Field>
            )}
          </div>
        </CardBlock>
      )}

      {/* Caveats + PII */}
      {(caveats.length > 0 || piiCols.length > 0) && (
        <CardBlock label="Caveats & PII">
          {caveats.map((cav, idx) => (
            <Callout key={idx} tone="amber" icon="!">{cav}</Callout>
          ))}
          {piiCols.length > 0 && (
            <Callout
              tone={allPiiResolved ? 'green' : 'red'}
              icon="⚑"
              title={allPiiResolved
                ? 'PII resolved'
                : resolvedPii.length > 0
                  ? `PII — ${resolvedPii.length} of ${piiCols.length} resolved`
                  : `PII detected (pii_columns: ${piiCols.length})`}
              action={!allPiiResolved && canAct ? (
                <button
                  type="button"
                  disabled={piiLoading || !objectId || !semanticCardId || semanticVersion == null}
                  onClick={handleResolvePii}
                  className={BTN_SECONDARY}
                >
                  {piiLoading ? 'Resolving…' : 'Resolve'}
                </button>
              ) : undefined}
            >
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {piiCols.map((col) => (
                  <span key={col} style={{ opacity: localPiiResolutions[col] ? 0.55 : 1, textDecoration: localPiiResolutions[col] ? 'line-through' : 'none' }}>
                    {colTag(col, col)}
                  </span>
                ))}
              </span>
            </Callout>
          )}
        </CardBlock>
      )}

      {/* Example queries */}
      {patterns.length > 0 && (
        <CardBlock
          label="Usage patterns"
          aside={patterns.length > PATTERNS_VISIBLE ? (
            <button
              type="button"
              onClick={() => setShowAllPatterns((v) => !v)}
              style={{ ...type.ui, color: 'var(--brand-a-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {showAllPatterns ? 'Show fewer' : `Show all ${patterns.length}`}
            </button>
          ) : undefined}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {visiblePatterns.map((p, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {p.intent && <span style={{ ...type.ui, color: 'var(--estate-ink)', fontWeight: 500 }}>{p.intent}</span>}
                {p.sql && <CodeBlock code={p.sql} />}
              </div>
            ))}
          </div>
        </CardBlock>
      )}

      {/* Review trail */}
      {semanticCardId && objectId && (
        <CardBlock label="Trust">
          <TrustActionBar
            objectId={objectId}
            semanticCardId={semanticCardId}
            currentStatus={localStatus}
            onConfirmed={(s) => setLocalStatus(s)}
          />
        </CardBlock>
      )}

      {/* Provenance */}
      {(modelId || promptVersion) && (
        <div style={{ ...type.caption, color: 'var(--estate-text-muted)', marginTop: 14 }}>
          {[modelId && `model_id ${modelId}`, promptVersion && `prompt_version ${promptVersion}`, semanticVersion != null && `version ${semanticVersion}`]
            .filter(Boolean).join(' · ')}
        </div>
      )}
    </Card>
  );
}
