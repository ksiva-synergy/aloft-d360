'use client';

// SectionHeader — one consistent heading for every section of the Estate
// object page: title, optional count, a one-line description of what the
// section answers, and an optional action on the right.

import React from 'react';
import { type } from '@/lib/typography/tokens';

interface SectionHeaderProps {
  title: string;
  description?: string;
  count?: number | string | null;
  /** Small status note after the count, e.g. "3 to review". */
  note?: React.ReactNode;
  action?: React.ReactNode;
}

export default function SectionHeader({ title, description, count, note, action }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 16,
        paddingBottom: 12,
        borderBottom: '1px solid var(--estate-border)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ ...type['title-section'], color: 'var(--estate-ink)', margin: 0 }}>{title}</h2>
          {count !== undefined && count !== null && (
            <span
              style={{
                ...type.caption,
                color: 'var(--estate-text-secondary)',
                background: 'var(--estate-active-bg)',
                borderRadius: 999,
                padding: '1px 9px',
              }}
            >
              {count}
            </span>
          )}
          {note}
        </div>
        {description && (
          <p style={{ ...type.ui, color: 'var(--estate-text-muted)', margin: 0 }}>{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
