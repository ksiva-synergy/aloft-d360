'use client';

import React from 'react';
import { ShieldAlert } from 'lucide-react';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

/** Amber, muted. The visible line between governed and escape-hatch. */
const AMBER = '#FDB515';

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
        ...MONO,
        fontSize,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: size === 'xs' ? '1px 5px' : '2px 6px',
        borderRadius: 3,
        background: 'rgba(253,181,21,0.12)',
        color: AMBER,
        border: '1px solid rgba(253,181,21,0.3)',
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
