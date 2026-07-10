'use client';

// LifecycleBadge — three-state lifecycle indicator for the Estate hero.
//
// Lifecycle derivation (DS3a — concrete signals from PlatformContextObject):
//   DISCOVERED  → last_t0_at is set, last_t2_at is null (no semantic card yet)
//   HARVESTED   → last_t2_at is set (semantic card exists)
//   PUBLISHED   → last_knowledge_sync_at is set (synced to agent knowledge base)
//
// Knowledge-stale warning badge (shown only when state is PUBLISHED):
//   - freshness.stale is true, OR
//   - hasEmbedding is false (knowledge sync ran but embedding is absent)
//
// If no last_t0_at exists, renders nothing (object is not yet inventoried).

import React from 'react';

export type LifecycleState = 'discovered' | 'harvested' | 'published';

export interface LifecycleBadgeProps {
  last_t0_at: string | null;
  last_t2_at: string | null;
  last_knowledge_sync_at: string | null;
  /** From freshness contract — true means structural data is stale */
  freshnessStale: boolean;
  /** True if a PlatformContextEmbedding row exists for this object */
  hasEmbedding: boolean;
}

const STATE_STYLES: Record<LifecycleState, { bg: string; color: string; border: string; dot: string; label: string }> = {
  discovered: {
    bg:     'rgba(138,130,113,.16)',
    color:  '#8a8271',
    border: 'rgba(138,130,113,.4)',
    dot:    '#8a8271',
    label:  'Discovered',
  },
  harvested: {
    bg:     'rgba(47,109,176,.14)',
    color:  '#2F6DB0',
    border: 'rgba(47,109,176,.4)',
    dot:    '#2F6DB0',
    label:  'Harvested',
  },
  published: {
    bg:     'rgba(59,122,75,.15)',
    color:  '#3B7A4B',
    border: 'rgba(59,122,75,.4)',
    dot:    '#3B7A4B',
    label:  'Published',
  },
};

const STALE_STYLE = {
  bg:     'rgba(194,90,46,.14)',
  color:  '#C25A2E',
  border: 'rgba(194,90,46,.4)',
};

export function deriveLifecycleState(
  last_t0_at: string | null,
  last_t2_at: string | null,
  last_knowledge_sync_at: string | null,
): LifecycleState | null {
  if (!last_t0_at) return null;
  if (last_knowledge_sync_at) return 'published';
  if (last_t2_at) return 'harvested';
  return 'discovered';
}

export default function LifecycleBadge({
  last_t0_at,
  last_t2_at,
  last_knowledge_sync_at,
  freshnessStale,
  hasEmbedding,
}: LifecycleBadgeProps) {
  const state = deriveLifecycleState(last_t0_at, last_t2_at, last_knowledge_sync_at);
  if (!state) return null;

  const s = STATE_STYLES[state];
  const isPublished = state === 'published';
  const knowledgeStale = isPublished && (freshnessStale || !hasEmbedding);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {/* State badge */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          padding: '3px 8px',
          borderRadius: 4,
          backgroundColor: s.bg,
          color: s.color,
          border: `1px solid ${s.border}`,
          textTransform: 'uppercase',
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            backgroundColor: s.dot,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        {s.label}
      </span>

      {/* Knowledge-stale warning — only when Published AND stale */}
      {knowledgeStale && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.08em',
            padding: '2px 6px',
            borderRadius: 3,
            backgroundColor: STALE_STYLE.bg,
            color: STALE_STYLE.color,
            border: `1px solid ${STALE_STYLE.border}`,
            textTransform: 'uppercase',
          }}
        >
          ⚠ Knowledge Stale
        </span>
      )}
    </div>
  );
}
