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
import { Tag, type Tone } from './object-ui';

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

const STATE: Record<LifecycleState, { tone: Tone; label: string; title: string }> = {
  discovered: { tone: 'neutral', label: 'Discovered', title: 'Found in the source — not described yet' },
  harvested:  { tone: 'blue',    label: 'Harvested',  title: 'Profiled and described — not yet in agent knowledge' },
  published:  { tone: 'green',   label: 'Published',  title: 'Available to agents through the knowledge base' },
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

  const s = STATE[state];
  const knowledgeStale = state === 'published' && (freshnessStale || !hasEmbedding);

  return (
    <>
      <Tag tone={s.tone} dot title={s.title}>{s.label}</Tag>
      {knowledgeStale && (
        <Tag
          tone="red"
          title={!hasEmbedding ? 'Synced to knowledge, but the search index is missing' : 'The source changed after agents were last updated'}
        >
          Knowledge stale
        </Tag>
      )}
    </>
  );
}
