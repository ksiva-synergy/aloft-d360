'use client';

// HeroSection — full redesigned hero for the Estate Object Detail page (DS3a).
//
// Supersedes the DS2 minimal insertion. Composes:
//   - Identity panel (left): title, breadcrumb metadata, native_comment, lifecycle badge
//   - Readiness panel (right): DATA ring (reused from DS2/DS2a), gating callout
//   - HarvestActionBar: per-tier re-harvest + silo scan
//   - FreshnessDot: inline freshness summary
//
// Design tokens from approved source (Estate Object Detail.dc.html):
//   Hero card:  background var(--estate-raised), border-top 3px solid #FDB515, border-radius 8px
//   Hero grid:  two columns (identity 55% / readiness 45%)
//   Object title: Source Serif 4, 28–33px, font-weight 600
//   native_comment: border-left 3px solid #e0b23c, border-radius 0 6px 6px 0

import React, { useRef } from 'react';
import Link from 'next/link';
import KindBadge from './KindBadge';
import FreshnessDot from './FreshnessDot';
import LifecycleBadge from './HeroLifecycleBadge';
import HarvestActionBar from './HarvestActionBar';
import DataReadinessRing from './DataReadinessRing';
import type { DataScoreShape } from './DataReadinessRing';
import type { FreshnessBlock } from './FreshnessCard';

interface HeroSectionProps {
  object: {
    id: string;
    source_id: string;
    object_kind: string;
    full_path: string;
    catalog_name: string | null;
    schema_name: string | null;
    object_name: string | null;
    native_comment: string | null;
    row_count_est: any;
    size_bytes_est: any;
    last_t0_at: string | null;
    last_t1_at: string | null;
    last_t2_at: string | null;
    last_t3_at: string | null;
    last_t4_at: string | null;
    last_knowledge_sync_at: string | null;
  };
  dataScore: DataScoreShape;
  freshness: FreshnessBlock;
  hasEmbedding: boolean;
  /** Ref forwarded to the ring div — used by DataReadinessPill IntersectionObserver */
  ringRef: React.RefObject<HTMLDivElement | null>;
}

function formatBytes(bytes: any): string {
  if (bytes === null || bytes === undefined) return '—';
  const val = Number(bytes);
  if (isNaN(val)) return '—';
  if (val < 1024) return `${val} B`;
  if (val < 1048576) return `${(val / 1024).toFixed(1)} KB`;
  if (val < 1073741824) return `${(val / 1048576).toFixed(1)} MB`;
  return `${(val / 1073741824).toFixed(1)} GB`;
}

export default function HeroSection({ object, dataScore, freshness, hasEmbedding, ringRef }: HeroSectionProps) {
  const inkColor = 'var(--estate-ink)';
  const mutedColor = 'var(--estate-text-muted)';
  const labelColor = 'var(--estate-text-secondary)';

  return (
    <div
      style={{
        background: 'var(--estate-raised)',
        border: '1px solid var(--estate-border-gold)',
        borderTop: '3px solid #FDB515',
        borderRadius: 8,
      }}
    >
      {/* Main two-column grid: identity | readiness */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.15fr 1fr',
        }}
      >
        {/* Left — identity panel */}
        <div
          style={{
            padding: '24px 26px',
            borderRight: '1px solid var(--estate-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* Kind + lifecycle row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <KindBadge kind={object.object_kind} />
            <LifecycleBadge
              last_t0_at={object.last_t0_at}
              last_t2_at={object.last_t2_at}
              last_knowledge_sync_at={object.last_knowledge_sync_at}
              freshnessStale={freshness.stale}
              hasEmbedding={hasEmbedding}
            />
          </div>

          {/* Object title */}
          <div>
            <h1
              style={{
                fontFamily: '"Source Serif 4", Georgia, serif',
                fontSize: 28,
                fontWeight: 600,
                color: inkColor,
                margin: 0,
                lineHeight: 1.2,
                wordBreak: 'break-all',
              }}
            >
              {object.object_name || object.full_path}
            </h1>
            {object.object_name && (
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 11,
                  color: mutedColor,
                  marginTop: 4,
                }}
              >
                {object.full_path}
              </div>
            )}
          </div>

          {/* Metadata row */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '4px 12px',
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 12,
              color: labelColor,
            }}
          >
            <span>{object.row_count_est !== null ? Number(object.row_count_est).toLocaleString() : '—'} rows</span>
            <span style={{ opacity: 0.3 }}>|</span>
            <span>~{formatBytes(object.size_bytes_est)}</span>
            <span style={{ opacity: 0.3 }}>|</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <FreshnessDot stale={freshness.stale} size={7} />
              <span style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.08em' }}>
                {freshness.stale ? 'Stale' : 'Current'}
              </span>
            </div>
          </div>

          {/* native_comment — accent rail on left */}
          {object.native_comment && (
            <div
              style={{
                borderLeft: '3px solid #e0b23c',
                borderRadius: '0 6px 6px 0',
                padding: '8px 12px',
                background: 'rgba(224,178,60,0.05)',
              }}
            >
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#e0b23c',
                  marginBottom: 4,
                }}
              >
                Native Comment
              </div>
              <p
                style={{
                  fontFamily: '"Inter Tight", sans-serif',
                  fontSize: 12,
                  color: 'var(--estate-text-secondary)',
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                {object.native_comment}
              </p>
            </div>
          )}

          {/* Action bar */}
          <div style={{ marginTop: 'auto', paddingTop: 8 }}>
            <HarvestActionBar
              objectId={object.id}
              sourceId={object.source_id}
              last_t0_at={object.last_t0_at}
              last_t1_at={object.last_t1_at}
              last_t2_at={object.last_t2_at}
              last_t3_at={object.last_t3_at}
              last_t4_at={object.last_t4_at}
            />
          </div>
        </div>

        {/* Right — DATA readiness panel */}
        <div
          style={{
            padding: '22px 26px',
            background: 'linear-gradient(180deg, var(--estate-hover, rgba(0,0,0,0.03)), transparent)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: labelColor,
            }}
          >
            DATA Readiness
          </div>
          {/* Ring — DS2/DS2a component, ref forwarded for pill IntersectionObserver */}
          <div ref={ringRef as React.RefObject<HTMLDivElement>}>
            <DataReadinessRing dataScore={dataScore} />
          </div>
        </div>
      </div>
    </div>
  );
}
