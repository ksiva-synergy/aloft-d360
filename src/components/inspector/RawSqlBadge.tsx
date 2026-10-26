'use client';

import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { inkOf } from '@/lib/typography/tokens';

const MONO: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
};

/** Amber, muted. The visible line between governed and escape-hatch. */
const AMBER = 'var(--brand-a)';

/**
 * Phase 3.5C — the "Unverified · Raw SQL" badge. Rendered everywhere a raw-SQL
 * chart or widget appears (saved-chart cards, dashboard widgets in the viewer +
 * builder, and the ad-hoc chat result). It must be impossible to look at a
 * raw-SQL artifact and not know it is outside semantic governance.
 */
export function RawSqlBadge({
  size = 'sm',
  title = 'Raw SQL — not governed, not drift-checked. Graduate it to a metric for governance.',
  style,
}: {
  size?: 'sm' | 'xs';
  title?: string;
  style?: React.CSSProperties;
}) {
  const fontSize = size === 'xs' ? 8 : 9;
  return (
    <span
      title={title}
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: size === 'xs' ? '1px 5px' : '2px 6px',
        borderRadius: 3,
        background: 'color-mix(in srgb, var(--brand-a) 12%, transparent)',
        color: inkOf(AMBER),
        border: '1px solid color-mix(in srgb, var(--brand-a) 30%, transparent)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}
    >
      <ShieldAlert size={size === 'xs' ? 8 : 10} />
      Unverified · Raw SQL
    </span>
  );
}
