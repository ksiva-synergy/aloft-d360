'use client';

// TrustActionBar — inline trust advancement for semantic cards.
//
// Sends { semanticCardId, status } — the semanticCardId identifies the SPECIFIC
// card version the steward reviewed. Version guard on server rejects confirmation
// if a newer version now exists (re-enrich ran between page load and click).
//
// On 409 VERSION_SUPERSEDED: shows a warning toast prompting page refresh.
// On 409 INVALID_TRANSITION: shows an error toast with current state.
// On success: calls onConfirmed() so the parent can refresh the card state.
//
// Rendered as a three-step trail (Assumed → Confirmed → Certified) with the
// next step as the call to action.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { type } from '@/lib/typography/tokens';
import { BTN_PRIMARY, TONE_COLOR } from './object-ui';

type TrustStatus = 'assumed' | 'confirmed' | 'certified';

interface TrustActionBarProps {
  objectId: string;
  /** The id of the SPECIFIC semantic card row rendered — NOT re-derived at click time */
  semanticCardId: string;
  /** Current trust status of the rendered card */
  currentStatus: TrustStatus | string;
  onConfirmed?: (newStatus: string) => void;
}

const STEPS: { id: TrustStatus; label: string; hint: string }[] = [
  { id: 'assumed',   label: 'assumed',   hint: 'LLM-generated' },
  { id: 'confirmed', label: 'confirmed', hint: 'Checked by a steward' },
  { id: 'certified', label: 'certified', hint: 'Approved for use' },
];

const STATUS_LABELS: Record<string, string> = {
  assumed:   'Assumed',
  confirmed: 'Confirmed',
  certified: 'Certified',
};

const NEXT_STATUS: Record<string, TrustStatus | null> = {
  assumed:   'confirmed',
  confirmed: 'certified',
  certified: null,
};

const NEXT_ACTION: Record<string, string> = {
  confirmed: 'Mark confirmed',
  certified: 'Mark certified',
};

export default function TrustActionBar({
  objectId,
  semanticCardId,
  currentStatus,
  onConfirmed,
}: TrustActionBarProps) {
  const [loading, setLoading] = useState(false);
  const [localStatus, setLocalStatus] = useState(currentStatus);

  const nextStatus = NEXT_STATUS[localStatus] ?? null;
  const currentIdx = Math.max(0, STEPS.findIndex((s) => s.id === localStatus));

  const handleAdvance = async () => {
    if (!nextStatus || loading || !semanticCardId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/agent-lab/context/objects/${objectId}/confirm-semantic`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ semanticCardId, status: nextStatus }),
        },
      );

      if (res.ok) {
        const json = await res.json();
        setLocalStatus(json.newStatus);
        onConfirmed?.(json.newStatus);
        toast.success(`Card status advanced to ${json.newStatus}`);
      } else {
        const json = await res.json().catch(() => ({}));
        if (json.error === 'VERSION_SUPERSEDED') {
          toast.warning(
            `A newer version of this card exists (v${json.latestVersion}). Refresh the page to review the latest card before confirming.`,
            { duration: 8000 },
          );
        } else if (json.error === 'INVALID_TRANSITION') {
          toast.error(`Cannot advance from ${json.current} to ${nextStatus}`);
        } else {
          toast.error('Failed to advance trust status');
        }
      }
    } catch {
      toast.error('Failed to advance trust status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--estate-bg)',
        border: '1px solid var(--estate-border)',
      }}
    >
      {/* Trust trail */}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} aria-label="Review status">
        {STEPS.map((step, i) => {
          const reached = i <= currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <li key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {i > 0 && (
                <span aria-hidden="true" style={{ width: 20, height: 2, borderRadius: 2, background: reached ? TONE_COLOR.green : 'var(--estate-border)' }} />
              )}
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={step.hint} aria-current={isCurrent ? 'step' : undefined}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: reached ? TONE_COLOR.green : 'transparent',
                    border: `2px solid ${reached ? TONE_COLOR.green : 'var(--estate-border)'}`,
                    color: '#fff',
                    ...type.caption,
                    lineHeight: 1,
                  }}
                >
                  {reached ? '✓' : ''}
                </span>
                <span style={{ ...type.ui, fontWeight: isCurrent ? 600 : 400, color: reached ? 'var(--estate-ink)' : 'var(--estate-text-muted)' }}>
                  {step.label}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {nextStatus ? (
        <button type="button" disabled={loading} onClick={handleAdvance} className={BTN_PRIMARY} style={{ border: 'none', cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Saving…' : NEXT_ACTION[nextStatus]}
        </button>
      ) : (
        <span style={{ ...type.ui, color: 'var(--estate-text-muted)' }}>certified — terminal state</span>
      )}
    </div>
  );
}
