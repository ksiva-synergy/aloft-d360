'use client';

import React from 'react';
import { TEXT_PRI, TEXT_MUT } from '@/lib/bandits/born-tokens';
import { type } from '@/lib/typography/tokens';

/**
 * Shared header for BORN dashboard cards: title, optional meta chip, one-line
 * subtitle, and a right-aligned actions slot. Title and subtitle truncate
 * rather than pushing the actions out of the card.
 */
export function PanelHeader({
  title,
  subtitle,
  meta,
  actions,
  style,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** Small muted text after the title, e.g. "4 arms". */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 16, marginBottom: 16, ...style,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <h2 style={{ ...type['title-section'], color: TEXT_PRI, margin: 0, whiteSpace: 'nowrap' }}>{title}</h2>
          {meta != null && (
            <span style={{ ...type.caption, color: TEXT_MUT, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {meta}
            </span>
          )}
        </div>
        {subtitle != null && (
          <div style={{ ...type.caption, color: TEXT_MUT, marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {actions != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div>
      )}
    </div>
  );
}

/** Card padding shared by every BORN panel (pair with className="born-card"). */
export const PANEL_PADDING = '20px 24px' as const;
