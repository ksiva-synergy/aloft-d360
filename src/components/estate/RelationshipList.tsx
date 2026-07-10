'use client';

// RelationshipList — consolidated relationship list for the Relationships region (DS3b).
//
// Always rendered alongside RelationshipGraph — NOT a fallback or conditional.
// The graph is for pattern spotting; this list is where detail + actions live.
//
// Four sources rendered in sections:
//   1. Entity group siblings (entity_group) — navigate-only, no action needed
//   2. FK candidates from semantic card ({ column, likely_target, confidence })
//   3. objectLinks — confirm + reject wired to PATCH /silo/links/[id]
//   4. Proposed mappings — confirm + reject wired to PATCH /mappings/[id]
//
// Mutation endpoints (confirmed accepted values from DS3b pre-check):
//   PATCH /api/agent-lab/context/silo/links/[id]   → { status: 'confirmed' | 'rejected' }
//   PATCH /api/agent-lab/context/mappings/[id]     → { status: 'confirmed' | 'rejected' }
//   Both require current status === 'proposed'. On 409 INVALID_TRANSITION, surface the error.
//
// Row click-through: resolvable object IDs navigate to /agent-lab/estate/objects/[id].
// Unresolved targets (no object_id, only path) render the path but skip navigation.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { FkCandidate, ObjectLinkItem, EntityGroupObject } from './RelationshipGraph';

interface MappingItem {
  id: string;
  status: string;
  left_column: {
    id: string;
    name: string;
    object_id: string;
  };
  right_column: {
    id: string;
    name: string;
    object_id: string;
  };
}

interface CoObjectItem {
  full_path: string;
  object_id?: string;
  co_count?: number;
}

export interface RelationshipListProps {
  focusObjectId: string;
  entityGroupObjects: EntityGroupObject[];
  fkCandidates: FkCandidate[];
  objectLinks: ObjectLinkItem[];
  proposedMappings: MappingItem[];
  coObjects: CoObjectItem[];
}

// ── Shared action pair (confirm + reject) ─────────────────────────────────

function ActionPair({
  itemId,
  endpoint,
  currentStatus,
  onAction,
}: {
  itemId: string;
  endpoint: string;
  currentStatus: string;
  onAction: (newStatus: string) => void;
}) {
  const [loading, setLoading] = useState<'confirmed' | 'rejected' | null>(null);

  if (currentStatus !== 'proposed') {
    const chipStyle =
      currentStatus === 'confirmed'
        ? { bg: 'rgba(59,122,75,.15)', color: '#3B7A4B', border: '1px solid rgba(59,122,75,.4)' }
        : { bg: 'rgba(178,58,50,.1)', color: '#B23A32', border: '1px solid rgba(178,58,50,.3)' };
    return (
      <span
        style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          padding: '2px 7px',
          borderRadius: 3,
          background: chipStyle.bg,
          color: chipStyle.color,
          border: chipStyle.border,
        }}
      >
        {currentStatus}
      </span>
    );
  }

  const send = async (status: 'confirmed' | 'rejected') => {
    if (loading) return;
    setLoading(status);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        onAction(status);
        toast.success(status === 'confirmed' ? 'Confirmed' : 'Rejected');
      } else {
        const json = await res.json().catch(() => ({}));
        if (json.error === 'INVALID_TRANSITION') {
          toast.error(`Cannot ${status}: current status is ${json.current}`);
        } else {
          toast.error(`Failed to ${status}`);
        }
      }
    } catch {
      toast.error(`Failed to ${status}`);
    } finally {
      setLoading(null);
    }
  };

  const btnBase: React.CSSProperties = {
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 3,
    border: 'none',
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.5 : 1,
    transition: 'all 0.1s ease',
  };

  return (
    <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
      <button
        type="button"
        title="Confirm"
        disabled={!!loading}
        onClick={() => send('confirmed')}
        style={{
          ...btnBase,
          background: 'rgba(59,122,75,.15)',
          color: '#3B7A4B',
        }}
      >
        {loading === 'confirmed' ? '…' : '✓'}
      </button>
      <button
        type="button"
        title="Reject"
        disabled={!!loading}
        onClick={() => send('rejected')}
        style={{
          ...btnBase,
          background: 'rgba(178,58,50,.1)',
          color: '#B23A32',
        }}
      >
        {loading === 'rejected' ? '…' : '✕'}
      </button>
    </div>
  );
}

// ── Shared section wrapper ────────────────────────────────────────────────

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div
        style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#8892A4',
          padding: '8px 14px 5px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {label} <span style={{ opacity: 0.55 }}>({count})</span>
      </div>
      {children}
    </div>
  );
}

// ── Confidence bar (for FK candidates) ───────────────────────────────────

function ConfBar({ value }: { value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 28, height: 3, borderRadius: 2, background: 'rgba(136,146,164,0.15)' }}>
        <div
          style={{
            width: `${Math.round(value * 100)}%`,
            height: '100%',
            borderRadius: 2,
            background: value >= 0.8 ? '#2DD4A0' : '#FDB515',
          }}
        />
      </div>
      <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 9, color: '#8892A4' }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────

export default function RelationshipList({
  focusObjectId,
  entityGroupObjects,
  fkCandidates,
  objectLinks,
  proposedMappings,
  coObjects,
}: RelationshipListProps) {
  const router = useRouter();

  // Local status overrides (optimistic updates after confirm/reject)
  const [linkStatuses, setLinkStatuses] = useState<Record<string, string>>({});
  const [mappingStatuses, setMappingStatuses] = useState<Record<string, string>>({});

  const inkColor = '#E8E6E1';
  const mutedColor = '#8892A4';

  const rowBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    cursor: 'default',
  };

  const hasAny =
    entityGroupObjects.length > 0 ||
    fkCandidates.length > 0 ||
    objectLinks.length > 0 ||
    proposedMappings.length > 0 ||
    coObjects.length > 0;

  if (!hasAny) {
    return (
      <div
        style={{
          padding: '24px 14px',
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 11,
          color: mutedColor,
          textAlign: 'center',
        }}
      >
        No relationships found yet.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--estate-raised)',
        border: '1px solid var(--estate-border-gold)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* ── Entity group siblings ────────────────────────────── */}
      <Section label="Entity Group" count={entityGroupObjects.length}>
        {entityGroupObjects.map((sib) => (
          <div
            key={sib.id}
            style={{
              ...rowBase,
              cursor: 'pointer',
            }}
            onClick={() => router.push(`/agent-lab/estate/objects/${sib.id}`)}
            title={sib.full_path}
          >
            {/* Source chip */}
            <span
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 8,
                fontWeight: 600,
                padding: '1px 5px',
                borderRadius: 2,
                background: 'rgba(59,122,75,.15)',
                color: '#3B7A4B',
                border: '1px solid rgba(59,122,75,.3)',
                letterSpacing: '0.06em',
                flexShrink: 0,
              }}
            >
              ENTITY GRP
            </span>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 12,
                  fontWeight: 600,
                  color: inkColor,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {sib.object_name || sib.full_path.split('.').pop()}
              </div>
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 9,
                  color: mutedColor,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {sib.full_path}
              </div>
            </div>
            <span style={{ fontSize: 10, color: '#FDB515', flexShrink: 0 }}>→</span>
          </div>
        ))}
      </Section>

      {/* ── FK candidates ──────────────────────────────────── */}
      <Section label="FK Candidates" count={fkCandidates.length}>
        {fkCandidates.map((fk, idx) => (
          <div key={idx} style={rowBase}>
            <span
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 8,
                fontWeight: 600,
                padding: '1px 5px',
                borderRadius: 2,
                background: 'rgba(47,109,176,.14)',
                color: '#2F6DB0',
                border: '1px solid rgba(47,109,176,.3)',
                flexShrink: 0,
              }}
            >
              FK
            </span>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 11,
                  color: inkColor,
                }}
              >
                <span style={{ color: '#FDB515' }}>{fk.column}</span>
                <span style={{ color: mutedColor, margin: '0 5px' }}>→</span>
                {fk.likely_target}
              </div>
            </div>
            <ConfBar value={fk.confidence} />
          </div>
        ))}
      </Section>

      {/* ── Object links (silo-links) ─────────────────────── */}
      <Section label="Object Links" count={objectLinks.length}>
        {objectLinks.map((link) => {
          const isLeft = link.left_object_id === focusObjectId;
          const targetId = isLeft ? link.right_object_id : link.left_object_id;
          const currentStatus = linkStatuses[link.id] ?? link.status;
          const llmV = link.llm_verdict as Record<string, unknown> | null;
          const verdict = typeof llmV?.verdict === 'string' ? llmV.verdict : null;

          return (
            <div key={link.id} style={rowBase}>
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 8,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 2,
                  background: 'rgba(253,181,21,.1)',
                  color: '#FDB515',
                  border: '1px solid rgba(253,181,21,.3)',
                  flexShrink: 0,
                  textTransform: 'uppercase',
                }}
              >
                {link.link_kind.replace('_', ' ')}
              </span>
              <div
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
                onClick={() => router.push(`/agent-lab/estate/objects/${targetId}`)}
                title={`Navigate to object ${targetId}`}
              >
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#FDB515',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {targetId}
                  <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.5 }}>→</span>
                </div>
                {verdict && (
                  <div
                    style={{
                      fontFamily: '"Inter Tight", sans-serif',
                      fontSize: 11,
                      color: mutedColor,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {verdict}
                  </div>
                )}
                {link.score != null && (
                  <ConfBar value={link.score} />
                )}
              </div>
              <ActionPair
                itemId={link.id}
                endpoint={`/api/agent-lab/context/silo/links/${link.id}`}
                currentStatus={currentStatus}
                onAction={(s) => setLinkStatuses((prev) => ({ ...prev, [link.id]: s }))}
              />
            </div>
          );
        })}
      </Section>

      {/* ── Proposed mappings ────────────────────────────── */}
      <Section label="Proposed Mappings" count={proposedMappings.length}>
        {proposedMappings.map((m) => {
          const currentStatus = mappingStatuses[m.id] ?? m.status;
          const otherColObj =
            m.left_column.object_id === focusObjectId
              ? m.right_column
              : m.left_column;
          const focusCol =
            m.left_column.object_id === focusObjectId
              ? m.left_column
              : m.right_column;

          return (
            <div key={m.id} style={rowBase}>
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 8,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 2,
                  background: 'rgba(138,130,113,.16)',
                  color: '#8a8271',
                  border: '1px solid rgba(138,130,113,.3)',
                  flexShrink: 0,
                }}
              >
                MAPPING
              </span>
              <div
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
                onClick={() => router.push(`/agent-lab/estate/objects/${otherColObj.object_id}`)}
                title={`Navigate to object ${otherColObj.object_id}`}
              >
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 11,
                    color: inkColor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: '#FDB515' }}>{focusCol.name}</span>
                  <span style={{ color: mutedColor, margin: '0 5px' }}>↔</span>
                  {otherColObj.name}
                </div>
                <div
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 9,
                    color: mutedColor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  target object: {otherColObj.object_id}
                </div>
              </div>
              <ActionPair
                itemId={m.id}
                endpoint={`/api/agent-lab/context/mappings/${m.id}`}
                currentStatus={currentStatus}
                onAction={(s) => setMappingStatuses((prev) => ({ ...prev, [m.id]: s }))}
              />
            </div>
          );
        })}
      </Section>

      {/* ── Usage co-objects (T3) ────────────────────────── */}
      <Section label="Usage Co-objects (T3)" count={coObjects.length}>
        {coObjects.map((co, idx) => (
          <div
            key={idx}
            style={{
              ...rowBase,
              cursor: co.object_id ? 'pointer' : 'default',
            }}
            onClick={() => {
              if (co.object_id) router.push(`/agent-lab/estate/objects/${co.object_id}`);
            }}
            title={co.object_id ? co.full_path : undefined}
          >
            <span
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 8,
                fontWeight: 600,
                padding: '1px 5px',
                borderRadius: 2,
                background: 'rgba(138,130,113,.12)',
                color: '#8a8271',
                border: '1px solid rgba(138,130,113,.25)',
                flexShrink: 0,
              }}
            >
              CO-OBJ
            </span>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 11,
                  color: co.object_id ? inkColor : mutedColor,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {co.full_path.split('.').pop()}
              </div>
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 9,
                  color: mutedColor,
                }}
              >
                {co.full_path}
                {!co.object_id && (
                  <span style={{ marginLeft: 5, opacity: 0.5 }}>(unresolved)</span>
                )}
              </div>
            </div>
            {co.co_count != null && (
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10,
                  color: mutedColor,
                  flexShrink: 0,
                }}
              >
                {co.co_count} co-queries
              </span>
            )}
            {co.object_id && <span style={{ fontSize: 10, color: '#FDB515', flexShrink: 0 }}>→</span>}
          </div>
        ))}
      </Section>
    </div>
  );
}
