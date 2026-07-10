'use client';

import React from 'react';

export type LifecycleState =
  | 'discovered'
  | 'scheduled'
  | 'queued'
  | 'analyzed'
  | 'enriched'
  | 'embedded'
  | 'connected'
  | 'modelled'
  | 'published'
  | 'stale'
  | 'inaccessible';

interface LifecycleBadgeProps {
  harvestState: string | null;
  lastT0At?: string | null;
  lastT1At?: string | null;
  lastT2At?: string | null;
  lastT3At?: string | null;
  lastT4At?: string | null;
  hasEmbedding?: boolean;
  lastKnowledgeSyncAt?: string | null;
}

export function computeLifecycle(
  harvestState: string | null,
  lastT2At?: string | null,
  lastKnowledgeSyncAt?: string | null,
  lastT0At?: string | null,
  lastT1At?: string | null,
  lastT3At?: string | null,
  hasEmbedding?: boolean,
  lastT4At?: string | null,
): LifecycleState {
  if (harvestState === 'inaccessible') return 'inaccessible';
  if (harvestState === 'scheduled') return 'scheduled';
  if (harvestState === 'queued') return 'queued';

  // Stage ladder: modelled > connected > embedded > enriched > analyzed > discovered
  if (lastT4At) return 'modelled';
  if (lastT3At) return 'connected';
  if (hasEmbedding) {
    if (!lastKnowledgeSyncAt || !lastT2At) return 'embedded';
    const syncTs = new Date(lastKnowledgeSyncAt).getTime();
    const t2Ts = new Date(lastT2At).getTime();
    if (syncTs >= t2Ts) return 'published';
    return 'stale';
  }
  if (lastT2At) return 'enriched';
  if (lastT1At) return 'analyzed';
  if (lastT0At) return 'discovered';

  return 'discovered';
}

export default function LifecycleBadge({ harvestState, lastT0At, lastT1At, lastT2At, lastT3At, lastT4At, hasEmbedding, lastKnowledgeSyncAt }: LifecycleBadgeProps) {
  const state = computeLifecycle(harvestState, lastT2At, lastKnowledgeSyncAt, lastT0At, lastT1At, lastT3At, hasEmbedding, lastT4At);

  const configs: Record<LifecycleState, { label: string; color: string; borderColor: string; bg: string; dotStyle: 'solid' | 'pulse' | 'hollow' | 'none' }> = {
    discovered: {
      label: 'Discovered',
      color: 'var(--estate-text-muted)',
      borderColor: 'var(--estate-btn-border)',
      bg: 'transparent',
      dotStyle: 'none',
    },
    inaccessible: {
      label: 'No Access',
      color: '#f87171',
      borderColor: 'rgba(248, 113, 113, 0.35)',
      bg: 'rgba(248, 113, 113, 0.06)',
      dotStyle: 'hollow',
    },
    scheduled: {
      label: 'Scheduled',
      color: '#60a5fa',
      borderColor: 'rgba(96, 165, 250, 0.4)',
      bg: 'rgba(96, 165, 250, 0.06)',
      dotStyle: 'solid',
    },
    queued: {
      label: 'Queued',
      color: '#f0a830',
      borderColor: 'rgba(240, 168, 48, 0.4)',
      bg: 'transparent',
      dotStyle: 'pulse',
    },
    analyzed: {
      label: 'Analyzed',
      color: '#34d399',
      borderColor: 'rgba(52, 211, 153, 0.35)',
      bg: 'rgba(52, 211, 153, 0.06)',
      dotStyle: 'solid',
    },
    enriched: {
      label: 'Enriched',
      color: '#a78bfa',
      borderColor: 'rgba(167, 139, 250, 0.35)',
      bg: 'rgba(167, 139, 250, 0.06)',
      dotStyle: 'solid',
    },
    embedded: {
      label: 'Embedded',
      color: '#818CF8',
      borderColor: 'rgba(129, 140, 248, 0.35)',
      bg: 'rgba(129, 140, 248, 0.06)',
      dotStyle: 'solid',
    },
    connected: {
      label: 'Connected',
      color: '#F59E0B',
      borderColor: 'rgba(245, 158, 11, 0.35)',
      bg: 'rgba(245, 158, 11, 0.06)',
      dotStyle: 'solid',
    },
    modelled: {
      label: 'Modelled',
      color: '#F472B6',
      borderColor: 'rgba(244, 114, 182, 0.35)',
      bg: 'rgba(244, 114, 182, 0.06)',
      dotStyle: 'solid',
    },
    published: {
      label: 'Published',
      color: '#FDB515',
      borderColor: 'rgba(253, 181, 21, 0.45)',
      bg: 'rgba(253, 181, 21, 0.08)',
      dotStyle: 'solid',
    },
    stale: {
      label: 'Sync stale',
      color: '#f0a830',
      borderColor: 'rgba(240, 168, 48, 0.35)',
      bg: 'transparent',
      dotStyle: 'hollow',
    },
  };

  const c = configs[state];

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider uppercase leading-none whitespace-nowrap"
      style={{
        color: c.color,
        border: `1px ${state === 'discovered' ? 'dashed' : 'solid'} ${c.borderColor}`,
        backgroundColor: c.bg,
        padding: '4px 9px',
        borderRadius: '6px',
      }}
    >
      {c.dotStyle !== 'none' && (
        <span
          className={c.dotStyle === 'pulse' ? 'animate-pulse' : ''}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            backgroundColor: c.dotStyle === 'hollow' ? 'transparent' : c.color,
            border: c.dotStyle === 'hollow' ? `1px solid ${c.color}` : 'none',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      )}
      {c.label}
    </span>
  );
}
