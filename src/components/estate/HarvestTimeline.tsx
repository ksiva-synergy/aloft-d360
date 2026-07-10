'use client';

// HarvestTimeline — DS3c Region 4 (Operations).
//
// Passive status strip showing the five harvest tiers (T0–T4) with per-tier
// timestamps and health state. Does NOT duplicate the action buttons in
// DS3a's HarvestActionBar — strictly a read-only status display.
//
// Color encoding reuses established tokens:
//   success  → #3B7A4B  (scoreColor ≥ 0.85 / lifecycle "Published" green)
//   failed   → #C25A2E  (scoreColor < 0.45 / rust-warn)
//   not-run  → muted at reduced opacity

import React from 'react';

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
}

const TIER_DEFS = [
  { key: 'last_t0_at', label: 'T0', title: 'Structural' },
  { key: 'last_t1_at', label: 'T1', title: 'Profile' },
  { key: 'last_t2_at', label: 'T2', title: 'Semantic' },
  { key: 'last_t3_at', label: 'T3', title: 'Usage' },
  { key: 'last_t4_at', label: 'T4', title: 'Entity Model' },
] as const;

const COLOR_SUCCESS = '#3B7A4B';
const COLOR_FAILED = '#C25A2E';
const COLOR_MUTED = 'var(--estate-text-muted)';

function formatTierDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Never';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function HarvestTimeline({ tiers, failures }: HarvestTimelineProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      {TIER_DEFS.map((def) => {
        const timestamp = tiers[def.key];
        const isFailed = failures?.[def.label.toLowerCase()] === true;
        const hasRun = timestamp !== null && timestamp !== undefined;

        let dotColor: string;
        let textColor: string;
        let borderCol: string;
        let bgCol: string;
        let opacity = 1;

        if (!hasRun) {
          dotColor = COLOR_MUTED;
          textColor = COLOR_MUTED;
          borderCol = 'var(--estate-border, rgba(255,255,255,0.08))';
          bgCol = 'transparent';
          opacity = 0.5;
        } else if (isFailed) {
          dotColor = COLOR_FAILED;
          textColor = COLOR_FAILED;
          borderCol = `rgba(194,90,46,0.4)`;
          bgCol = 'rgba(194,90,46,0.06)';
        } else {
          dotColor = COLOR_SUCCESS;
          textColor = 'var(--estate-text-secondary)';
          borderCol = 'rgba(59,122,75,0.3)';
          bgCol = 'rgba(59,122,75,0.04)';
        }

        return (
          <div
            key={def.key}
            style={{
              flex: '1 1 0',
              minWidth: 100,
              border: `1px solid ${borderCol}`,
              borderRadius: 6,
              padding: '10px 12px',
              background: bgCol,
              opacity,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {/* Tier label + dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: dotColor,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: dotColor,
                }}
              >
                {def.label}
              </span>
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 9,
                  color: textColor,
                  opacity: 0.7,
                }}
              >
                {def.title}
              </span>
            </div>

            {/* Timestamp */}
            <div
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: 10,
                color: textColor,
              }}
            >
              {formatTierDate(timestamp)}
            </div>

            {/* Status label */}
            {isFailed && (
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 9,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: COLOR_FAILED,
                }}
              >
                Last run failed
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
