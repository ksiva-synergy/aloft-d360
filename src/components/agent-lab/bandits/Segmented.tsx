'use client';

import React from 'react';
import { TEXT_MUT } from '@/lib/bandits/born-tokens';
import { type } from '@/lib/typography/tokens';

export interface SegmentedOption<T> {
  label: string;
  value: T;
}

/**
 * Compact segmented toggle for the BORN dashboard. Styling lives in globals.css
 * (`.born-seg-track`, `.born-seg`) so hover and focus states work.
 */
export function Segmented<T extends string | number | null>({
  label,
  options,
  value,
  onChange,
}: {
  /** Visible group label; also used as the group's accessible name. */
  label?: string;
  options: SegmentedOption<T>[];
  value: T;
  /** NoInfer: let `options`/`value` pick T, so a React setState can be passed directly. */
  onChange: (value: NoInfer<T>) => void;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {label && <span style={{ ...type.eyebrow, color: TEXT_MUT }}>{label}</span>}
      <div className="born-seg-track">
        {options.map(o => (
          <button
            key={String(o.value)}
            type="button"
            className="born-seg"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            style={type.ui}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
