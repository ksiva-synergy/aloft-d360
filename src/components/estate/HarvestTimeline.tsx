'use client';

// HarvestTimeline — "Harvest status" card: the five harvest steps (T0–T4) as
// a horizontal tracker, plus freshness (is the structure older than the last
// change in the source?). Read-only; actions live in HarvestActionBar.
//
// Pass `freshness` to merge the old FreshnessCard into this card.

import React from 'react';
import { Card, Callout, Tag, relTime, fullTime, TONE_COLOR } from './object-ui';
import type { FreshnessBlock } from './FreshnessCard';
import { type } from '@/lib/typography/tokens';

export interface HarvestTierStatus {
  last_t0_at: string | null;
  last_t1_at: string | null;
  last_t2_at: string | null;
  last_t3_at: string | null;
  last_t4_at: string | null;
}

interface HarvestTimelineProps {
  tiers: HarvestTierStatus;
  /** Per-tier failure flags — key is tier label (t0..t4), true = last run failed */
  failures?: Record<string, boolean>;
  freshness?: FreshnessBlock;
  /** Job kinds queued / running for this object — shows a pulsing step. */
  activeJobKinds?: string[];
}

const TIER_DEFS = [
  { key: 'last_t0_at', label: 'T0', title: 'Structural',   hint: 't0_structural', kinds: ['t0_structural'] },
  { key: 'last_t1_at', label: 'T1', title: 'Profile',      hint: 't1_profile',    kinds: ['t1_profile'] },
  { key: 'last_t2_at', label: 'T2', title: 'Semantic',     hint: 't2_semantic',   kinds: ['t2_semantic'] },
  { key: 'last_t3_at', label: 'T3', title: 'Usage',        hint: 't3_usage',      kinds: ['t3_usage', 't3_connected'] },
  { key: 'last_t4_at', label: 'T4', title: 'Entity Model', hint: 't4_scan',       kinds: ['t4_scan', 't4_entity_propose', 't4_dim_propose'] },
] as const;

type StepState = 'done' | 'running' | 'failed' | 'todo';

function StepDot({ state }: { state: StepState }) {
  const color = state === 'failed' ? TONE_COLOR.red : state === 'running' ? TONE_COLOR.blue : TONE_COLOR.green;
  const filled = state === 'done' || state === 'failed';
  return (
    <span
      aria-hidden="true"
      className={state === 'running' ? 'animate-pulse' : undefined}
      style={{
        width: 24,
        height: 24,
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: filled ? color : 'var(--estate-raised)',
        border: `2px solid ${state === 'todo' ? 'var(--estate-border)' : color}`,
        color: '#fff',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {state === 'done' && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      )}
      {state === 'failed' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      )}
      {state === 'running' && <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />}
    </span>
  );
}

export default function HarvestTimeline({ tiers, failures, freshness, activeJobKinds = [] }: HarvestTimelineProps) {
  const steps = TIER_DEFS.map((def) => {
    const ts = tiers[def.key];
    const failed = failures?.[def.label.toLowerCase()] === true;
    const running = def.kinds.some((k) => activeJobKinds.includes(k));
    const state: StepState = running ? 'running' : failed ? 'failed' : ts ? 'done' : 'todo';
    return { ...def, ts, state };
  });
  const doneCount = steps.filter((s) => s.state === 'done').length;

  const sourceChanged = freshness?.source_altered_at ?? null;
  const structureAt = freshness?.structural_as_of ?? tiers.last_t0_at;
  const sourceNewer = !!(sourceChanged && structureAt && new Date(sourceChanged) > new Date(structureAt));

  return (
    <Card
      title="Harvest status"
      style={{ height: "100%" }}
      meta={`${doneCount} of ${steps.length} steps done`}
      actions={freshness
        ? (freshness.stale ? <Tag tone="amber" dot>Stale</Tag> : <Tag tone="green" dot>Up to date</Tag>)
        : undefined}
    >
      {/* Tracker */}
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
          gap: 0,
        }}
        aria-label="Harvest steps"
      >
        {steps.map((s, i) => {
          const nextDone = i < steps.length - 1 && steps[i + 1].state !== 'todo';
          return (
            <li key={s.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, position: 'relative', minWidth: 0 }}>
              {/* connector to the next step */}
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 11,
                    left: 'calc(50% + 14px)',
                    right: 'calc(-50% + 14px)',
                    height: 2,
                    borderRadius: 2,
                    background: s.state === 'done' && nextDone ? TONE_COLOR.green : 'var(--estate-border)',
                  }}
                />
              )}
              <StepDot state={s.state} />
              <span style={{ ...type.ui, fontWeight: 600, color: s.state === 'todo' ? 'var(--estate-text-muted)' : 'var(--estate-ink)', overflowWrap: 'anywhere' }}>
                {s.label} {s.title}
              </span>
              <code style={{ ...type['code-inline'], color: 'var(--estate-text-muted)' }}>{s.hint}</code>
              <span
                title={fullTime(s.ts)}
                style={{
                  ...type.caption,
                  fontWeight: 600,
                  color: s.state === 'failed' ? TONE_COLOR.red : s.state === 'running' ? TONE_COLOR.blue : s.state === 'done' ? 'var(--estate-text-secondary)' : 'var(--estate-text-muted)',
                }}
              >
                {s.state === 'running' ? 'Running…' : s.state === 'failed' ? 'Failed' : s.ts ? relTime(s.ts) : 'Not run'}
              </span>
              
            </li>
          );
        })}
      </ol>

      {/* Freshness */}
      {freshness && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--estate-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 12 }}>
            {[
              { label: 'source_altered_at', iso: sourceChanged, warn: sourceNewer },
              { label: 'structural_as_of', iso: freshness.structural_as_of, warn: false },
              { label: 'profile_as_of', iso: freshness.profile_as_of, warn: false },
            ].map((f) => (
              <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title={fullTime(f.iso)}>
                <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>{f.label}</span>
                <span style={{ ...type.ui, fontWeight: 600, color: f.warn ? TONE_COLOR.amber : f.iso ? 'var(--estate-ink)' : 'var(--estate-text-muted)' }}>
                  {relTime(f.iso)}
                </span>
              </div>
            ))}
          </div>
          {(freshness.stale || sourceNewer) && (
            <Callout tone="amber" title="The source changed after the last scan">
              {freshness.guidance || 'Run Reharvest All to pick up the change.'}
            </Callout>
          )}
        </div>
      )}
    </Card>
  );
}
