'use client';

/**
 * VerificationChip — the honest, read-only outcome of verify_claim.
 *
 * Three calm states, never a 500 bubble (the governed-only gate returns a typed
 * `not_verifiable` result — see reflect-tools verify_claim):
 *   confirmed     → green, "N row(s)"
 *   unconfirmed   → muted, "0 rows (advisory)"
 *   not_verifiable→ muted, "model not governed" (or the server's reason)
 */
import React from 'react';
import { Check, HelpCircle } from 'lucide-react';
import type { VerificationResult } from '@/lib/inspector/reflect-tools';
import { FONT_MONO, mix } from './teach-tokens';

export function VerificationChip({ v, compact = false }: { v: VerificationResult; compact?: boolean }) {
  const confirmed = v.state === 'confirmed';
  const color = confirmed ? 'var(--success)' : 'var(--muted-foreground)';

  const caption =
    v.state === 'confirmed' ? 'Checked · estate'
    : v.state === 'unconfirmed' ? 'Checked · estate'
    : 'Can’t verify';

  const detail =
    v.state === 'confirmed'
      ? `confirmed${typeof v.rowCount === 'number' ? ` · ${v.rowCount.toLocaleString()} row${v.rowCount === 1 ? '' : 's'}` : ''}`
      : v.state === 'unconfirmed'
      ? 'couldn’t confirm — 0 rows (advisory)'
      : v.reason || 'model not governed';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        marginTop: compact ? 6 : 8,
        padding: compact ? '6px 10px' : '8px 12px',
        borderRadius: compact ? 8 : 10,
        background: confirmed ? mix('var(--success)', 13) : 'var(--muted)',
        boxShadow: confirmed
          ? `inset 0 0 0 1px ${mix('var(--success)', 30)}`
          : 'inset 0 0 0 1px var(--border)',
        maxWidth: '100%',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          borderRadius: '50%',
          flexShrink: 0,
          background: confirmed ? 'var(--success)' : 'transparent',
          color: confirmed ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          boxShadow: confirmed ? 'none' : 'inset 0 0 0 1.5px var(--text-tertiary)',
        }}
      >
        {confirmed ? <Check size={11} strokeWidth={3} /> : <HelpCircle size={12} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontFamily: FONT_MONO,
            fontSize: 8.5,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color,
          }}
        >
          {caption}
        </span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted-foreground)', lineHeight: 1.35 }}>
          {detail}
        </span>
      </span>
    </div>
  );
}

export default VerificationChip;
