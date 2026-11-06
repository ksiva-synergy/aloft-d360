'use client';

// FreshnessCard — when each layer of metadata was last captured, versus when
// the source last changed. Rows: structure (T0), profile (T1), source change.

import React from 'react';
import FreshnessDot from './FreshnessDot';
import { Card, Callout, Tag, relTime, fullTime } from './object-ui';
import { type } from '@/lib/typography/tokens';

export interface FreshnessBlock {
  structural_as_of: string | null;
  profile_as_of: string | null;
  source_altered_at: string | null;
  stale: boolean;
  guidance: string;
}

interface FreshnessCardProps {
  freshness: FreshnessBlock;
}

function Row({ label, hint, iso, ok }: { label: string; hint: string; iso: string | null; ok?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--estate-border)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ ...type.ui, color: 'var(--estate-ink)', fontWeight: 500 }}>{label}</span>
        <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>{hint}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={fullTime(iso)}>
        <span style={{ ...type.ui, color: iso ? 'var(--estate-ink)' : 'var(--estate-text-muted)' }}>{relTime(iso)}</span>
        {ok !== undefined && <FreshnessDot stale={!ok} size={8} />}
      </div>
    </div>
  );
}

export default function FreshnessCard({ freshness }: FreshnessCardProps) {
  return (
    <Card
      title="Freshness"
      tone={freshness.stale ? 'amber' : undefined}
      actions={freshness.stale
        ? <Tag tone="amber" dot>Stale</Tag>
        : <Tag tone="green" dot>Current</Tag>}
    >
      <div style={{ marginTop: -10 }}>
        <Row label="Structure" hint="Columns and types (T0)" iso={freshness.structural_as_of} ok={!freshness.stale} />
        <Row label="Profile" hint="Counts, nulls, ranges (T1)" iso={freshness.profile_as_of} ok={freshness.profile_as_of !== null} />
        <Row label="Source changed" hint="Last change in the source system" iso={freshness.source_altered_at} />
      </div>
      {freshness.guidance && (
        <div style={{ marginTop: 12 }}>
          <Callout tone={freshness.stale ? 'amber' : 'neutral'}>{freshness.guidance}</Callout>
        </div>
      )}
    </Card>
  );
}
