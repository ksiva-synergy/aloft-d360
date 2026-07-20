'use client';

/**
 * LearningCard — one card in the "What Marcus is learning" rail.
 *
 * Every field maps to a `learning_item` (and later verification_result) event
 * field; nothing is scraped from chat text. Renders: type tag · state badge ·
 * statement · a state-specific footer · recall expander · conflict resolver.
 */
import React, { useState } from 'react';
import { Check, ArrowRight, Loader2 } from 'lucide-react';
import type { Learning, LearningState } from '@/lib/inspector/reflect-tools';
import { FONT_BODY, FONT_MONO, STATE_VAR, STATE_LABEL, TYPE_LABEL, mix, surfaceCard } from './teach-tokens';
import { VerificationChip } from './VerificationChip';
import { MemoryRecallExpander } from './MemoryRecallExpander';
import { ConflictResolver } from './ConflictResolver';

export function LearningCard({
  learning,
  onResolve,
  onVerify,
}: {
  learning: Learning;
  onResolve: (learningId: string, nextState: LearningState) => void;
  /** Sends a follow-up asking Marcus to verify — a real narrative action. */
  onVerify?: (learning: Learning) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const color = STATE_VAR[learning.state];
  const isConflict = learning.state === 'conflict';
  const isVerifying = learning.state === 'verifying';

  return (
    <div
      style={{
        ...surfaceCard,
        border: isConflict || isVerifying ? 'none' : '1px solid var(--border)',
        boxShadow: isConflict
          ? `inset 0 0 0 ${resolving ? 2 : 1}px ${mix('var(--warning)', resolving ? 60 : 42)}, 0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)`
          : isVerifying
          ? `inset 0 0 0 1px ${mix('var(--primary)', 40)}, 0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)`
          : '0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)',
        animation: isVerifying ? 'tm-ring 1.6s ease-out infinite' : 'tm-up .3s ease',
      }}
    >
      {/* Header: type tag + state badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 8.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          {TYPE_LABEL[learning.type]}
        </span>
        <StateBadge state={learning.state} color={color} />
      </div>

      {/* Statement */}
      <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 500, lineHeight: 1.5, color: 'var(--foreground)', margin: 0 }}>
        {learning.statement}
      </p>

      {/* Conflict warning strip */}
      {isConflict && learning.conflict && (
        <div
          style={{
            marginTop: 11,
            padding: '9px 11px',
            borderRadius: 9,
            background: mix('var(--warning)', 9),
            boxShadow: `inset 0 0 0 1px ${mix('var(--warning)', 26)}`,
            fontSize: 12,
            color: 'var(--foreground)',
            lineHeight: 1.45,
          }}
        >
          Existing memory says the opposite. Needs your call.
        </div>
      )}

      {/* State-specific footer */}
      {learning.state === 'verified' && learning.verification_result && (
        <VerificationChip v={learning.verification_result} compact />
      )}

      {learning.state === 'proposed' && onVerify && (
        <div style={{ marginTop: 11 }}>
          <button type="button" onClick={() => onVerify(learning)} style={ghostBtn}>
            Verify against estate <ArrowRight size={11} />
          </button>
        </div>
      )}

      {isVerifying && <VerifyingBar />}

      {isConflict && !resolving && (
        <div style={{ marginTop: 11 }}>
          <button type="button" onClick={() => setResolving(true)} style={amberBtn}>
            Resolve conflict <ArrowRight size={11} />
          </button>
        </div>
      )}

      {isConflict && resolving && (
        <div style={{ marginTop: 12 }}>
          <ConflictResolver
            learning={learning}
            layout="stacked"
            onResolve={(nextState) => onResolve(learning.id, nextState)}
          />
        </div>
      )}

      {/* Recall — the memories Marcus consulted for this learning */}
      <MemoryRecallExpander hits={learning.related_memory_hits} conflict={learning.conflict} />
    </div>
  );
}

function StateBadge({ state, color }: { state: LearningState; color: string }) {
  const verified = state === 'verified';
  const verifying = state === 'verifying';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 20,
        background: mix(color, 14),
        color,
        fontFamily: FONT_MONO,
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}
    >
      {verified ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: color,
            color: 'var(--primary-foreground)',
          }}
        >
          <Check size={7} strokeWidth={4} />
        </span>
      ) : verifying ? (
        <Loader2 size={9} style={{ animation: 'tm-spin .7s linear infinite' }} />
      ) : (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      )}
      {STATE_LABEL[state]}
    </span>
  );
}

/** The shimmering progress bar shown while a claim is being verified. */
function VerifyingBar() {
  return (
    <div
      style={{
        marginTop: 11,
        height: 6,
        borderRadius: 6,
        background: 'var(--muted)',
        backgroundImage: `linear-gradient(90deg, transparent, ${mix('var(--primary)', 70)}, transparent)`,
        backgroundSize: '200% 100%',
        animation: 'tm-shimmer 1.15s linear infinite',
      }}
    />
  );
}

const ghostBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 11px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: 'var(--muted)',
  boxShadow: 'inset 0 0 0 1px var(--border)',
  color: 'var(--muted-foreground)',
  fontFamily: FONT_MONO,
  fontSize: 8.5,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const amberBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 11px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: 'var(--warning)',
  color: 'var(--primary-foreground)',
  fontFamily: FONT_MONO,
  fontSize: 8.5,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

export default LearningCard;
