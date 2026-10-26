'use client';

import React, { useState } from 'react';
import { type } from '@/lib/typography/tokens';

// ─── Design tokens ────────────────────────────────────────────────────────────
const GOLD       = 'var(--brand-a)';
const NAVY       = 'var(--brand-a-ink)';
const NAVY2      = 'color-mix(in srgb, var(--brand-a) 45%, transparent)';
const TXT        = 'var(--ink-1)';
const TXT2       = 'var(--ink-2)';
const TXT3       = 'var(--ink-3)';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const body: React.CSSProperties = { fontFamily: 'var(--font-sans)' };

// ─── Class display names ──────────────────────────────────────────────────────

const CLASS_NAMES: Record<string, string> = {
  feynman: 'Feynman',
  fermi: 'Fermi',
  grossmann: 'Grossmann',
  rama: 'Rama',
  // Seneca = agent class (communication, Coming Soon) — not builder persona
  seneca: 'Seneca',
  marcus: 'Captain Track Sparrow',
};

function classDisplayName(classId: string): string {
  return CLASS_NAMES[classId] ?? (classId.charAt(0).toUpperCase() + classId.slice(1));
}

// ─── ClassSuggestionChip ──────────────────────────────────────────────────────

export interface ClassSuggestionChipProps {
  classId: string;
  confidence: number;
  rationale: string;
  sessionId: string | null;
  onApply: (updatedClass: unknown, updatedMemory: unknown) => void;
  /** Called on both Apply (after success) and Keep classless (immediately). */
  onDismiss: () => void;
}

export function ClassSuggestionChip({
  classId,
  confidence,
  rationale,
  sessionId,
  onApply,
  onDismiss,
}: ClassSuggestionChipProps) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    if (!sessionId) {
      // No session yet — can't persist; dismiss gracefully
      onDismiss();
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch('/api/agent-lab/construction/class', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, classId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? `Apply failed (${res.status})`);
        setApplying(false);
        return;
      }
      const data = await res.json() as { class: unknown; memory: unknown };
      onApply(data.class, data.memory);
      // Both paths clear the suggestion
      onDismiss();
    } catch {
      setError('Network error — please try again');
      setApplying(false);
    }
  };

  const handleKeepClassless = () => {
    // Immediate dismiss — no state change
    onDismiss();
  };

  const confidencePct = Math.round(confidence * 100);
  const className = classDisplayName(classId);

  return (
    <div style={{
      background: 'color-mix(in srgb, var(--brand-a) 6%, transparent)',
      border: `1px solid ${GOLD}`,
      borderRadius: 6,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          ...mono, fontSize: 'var(--type-ui-regular-size)', color: '#1a1205',
          background: GOLD,
          borderRadius: 3,
          padding: '2px 8px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          flexShrink: 0,
        }}>
          {classId.toUpperCase()}
        </span>
        <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: TXT2 }}>
          {confidencePct}% match
        </span>
      </div>

      {/* Question */}
      <p style={{ ...body, fontSize: 'var(--type-body-size)', color: TXT, margin: 0, lineHeight: 1.5, fontWeight: 500 }}>
        This reads like <strong style={{ color: GOLD }}>{className}</strong>-class territory. Apply it?
      </p>

      {/* Rationale */}
      <p style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: TXT3, margin: 0, lineHeight: 1.5 }}>
        {rationale}
      </p>

      {/* Error */}
      {error && (
        <p style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: '#ef4444', margin: 0 }}>{error}</p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleApply}
          disabled={applying}
          style={{
            ...type.label,
            letterSpacing: '0.08em',
            background: NAVY,
            color: '#ffffff',
            border: `1px solid ${NAVY2}`,
            borderRadius: 4,
            padding: '8px 16px',
            cursor: applying ? 'wait' : 'pointer',
            opacity: applying ? 0.7 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
        <button
          onClick={handleKeepClassless}
          disabled={applying}
          style={{
            ...mono, fontSize: 'var(--type-ui-regular-size)',
            background: 'transparent',
            color: TXT2,
            border: 0,
            padding: '8px 12px',
            cursor: applying ? 'not-allowed' : 'pointer',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = TXT; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = TXT2; }}
        >
          Keep classless
        </button>
      </div>
    </div>
  );
}
