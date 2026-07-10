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

import React, { useState } from 'react';
import { toast } from 'sonner';

type TrustStatus = 'assumed' | 'confirmed' | 'certified';

interface TrustActionBarProps {
  objectId: string;
  /** The id of the SPECIFIC semantic card row rendered — NOT re-derived at click time */
  semanticCardId: string;
  /** Current trust status of the rendered card */
  currentStatus: TrustStatus | string;
  onConfirmed?: (newStatus: string) => void;
}

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

const CHIP_STYLES: Record<string, React.CSSProperties> = {
  assumed: {
    background: 'rgba(180,128,26,.14)',
    color:      '#B4801A',
    border:     '1px solid rgba(180,128,26,.4)',
  },
  confirmed: {
    background: 'rgba(47,109,176,.14)',
    color:      '#2F6DB0',
    border:     '1px solid rgba(47,109,176,.4)',
  },
  certified: {
    background: 'rgba(59,122,75,.15)',
    color:      '#3B7A4B',
    border:     '1px solid rgba(59,122,75,.4)',
  },
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
  const chipStyle = CHIP_STYLES[localStatus] ?? CHIP_STYLES.assumed;

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
        toast.success(`Card status advanced to ${STATUS_LABELS[json.newStatus] ?? json.newStatus}`);
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
        gap: 8,
        paddingTop: 12,
        borderTop: '1px solid var(--estate-border-gold)',
        marginTop: 4,
      }}
    >
      {/* Current status chip */}
      <span
        style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          padding: '3px 8px',
          borderRadius: 4,
          textTransform: 'uppercase',
          ...chipStyle,
        }}
      >
        {STATUS_LABELS[localStatus] ?? localStatus}
      </span>

      {/* Advance button — only when there is a next step */}
      {nextStatus && (
        <>
          <span
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 10,
              color: 'var(--estate-text-muted, #8892A4)',
            }}
          >
            →
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={handleAdvance}
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '3px 10px',
              borderRadius: 3,
              border: '1px solid rgba(253,181,21,0.35)',
              background: 'transparent',
              color: loading ? 'rgba(253,181,21,0.4)' : '#FDB515',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.12s ease',
            }}
          >
            {loading ? 'Confirming…' : `Mark ${STATUS_LABELS[nextStatus]}`}
          </button>
        </>
      )}

      {/* Fully certified — terminal state */}
      {localStatus === 'certified' && (
        <span
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 9,
            color: 'rgba(59,122,75,0.7)',
            letterSpacing: '0.08em',
          }}
        >
          ✓ Trust certified
        </span>
      )}
    </div>
  );
}
