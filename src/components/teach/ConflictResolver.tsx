'use client';

/**
 * ConflictResolver — side-by-side existing-vs-new, user must pick before the
 * learning advances.
 *
 * Resolution is CLIENT-TRANSIENT: it advances the card's state in-session only.
 * It is NOT a governed write — committing to memory is Build, a separate step
 * (mockup: "the memory commit happens later, outside Teach"; build-plan Phase 3).
 * The choice→next-state mapping mirrors reflect-tools' nextStateForResolution:
 * keep_existing → the new learning is rejected; keep_new / scope → proposed.
 */
import React, { useState } from 'react';
import { Check } from 'lucide-react';
import type { Learning, LearningState } from '@/lib/inspector/reflect-tools';
import { FONT_DISPLAY, FONT_MONO, mix } from './teach-tokens';

type ConflictChoice = 'keep_new' | 'keep_existing' | 'scope_by_context';

const CHOICES: { key: ConflictChoice; label: string; detail: string }[] = [
  { key: 'keep_new', label: 'Keep the new definition', detail: 'Supersede the existing rule' },
  { key: 'keep_existing', label: 'Keep the existing rule', detail: 'Discard the new learning' },
  { key: 'scope_by_context', label: 'Both — scope by context', detail: 'Each applies in its own context' },
];

function nextStateFor(choice: ConflictChoice): LearningState {
  return choice === 'keep_existing' ? 'rejected' : 'proposed';
}

export function ConflictResolver({
  learning,
  onResolve,
  layout = 'wide',
}: {
  learning: Learning;
  onResolve: (nextState: LearningState, choice: ConflictChoice) => void;
  /** 'wide' = 3-col grid (center thread); 'stacked' = single column (408px rail). */
  layout?: 'wide' | 'stacked';
}) {
  const [chosen, setChosen] = useState<ConflictChoice | null>(null);
  if (!learning.conflict) return null;
  const stacked = layout === 'stacked';

  const pick = (choice: ConflictChoice) => {
    setChosen(choice);
    onResolve(nextStateFor(choice), choice);
  };

  const confirmText =
    chosen === 'keep_new'
      ? `You chose to supersede the rule with: "${learning.statement}"`
      : chosen === 'keep_existing'
      ? `You kept the existing rule; the new learning was discarded.`
      : `You scoped both by context.`;

  return (
    <div style={{ animation: 'tm-up .25s ease' }}>
      <div style={{ ...pill('var(--warning)'), marginBottom: 12 }}>
        Conflict with existing memory · which is correct?
      </div>

      {/* Side-by-side existing vs new */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: stacked ? '1fr' : '1fr auto 1fr',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)',
          overflow: 'hidden',
        }}
      >
        {/* Existing */}
        <div style={{ padding: '18px 18px 20px' }}>
          <div style={caption}>Existing memory</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, lineHeight: 1.4, color: 'var(--foreground)', margin: '8px 0 10px' }}>
            {learning.conflict.existingStatement}
          </div>
          {learning.conflict.note && (
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{learning.conflict.note}</div>
          )}
        </div>

        {/* VS divider */}
        <div
          style={{
            position: 'relative',
            width: stacked ? 'auto' : 1,
            height: stacked ? 1 : 'auto',
            background: 'var(--border)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'var(--background)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: '0.08em',
              color: 'var(--text-tertiary)',
            }}
          >
            VS
          </span>
        </div>

        {/* New */}
        <div style={{ padding: '18px 18px 20px', background: mix('var(--primary)', 6) }}>
          <div style={{ ...caption, color: 'var(--primary)' }}>New — this session</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, lineHeight: 1.4, color: 'var(--foreground)', margin: '8px 0 10px' }}>
            {learning.statement}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Taught in this session</div>
        </div>
      </div>

      {/* Choice buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        {CHOICES.map((c) => {
          const selected = chosen === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => pick(c.key)}
              style={{
                flex: 1,
                minWidth: 160,
                textAlign: 'left',
                padding: '13px 15px',
                borderRadius: 12,
                border: 'none',
                cursor: 'pointer',
                background: 'var(--card)',
                color: 'var(--foreground)',
                boxShadow: selected
                  ? 'inset 0 0 0 2px var(--primary), 0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)'
                  : 'inset 0 0 0 1px var(--border), 0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)',
                transition: 'box-shadow .15s',
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 3 }}>{c.detail}</div>
            </button>
          );
        })}
      </div>

      {chosen && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 14,
            padding: '12px 14px',
            borderRadius: 12,
            background: mix('var(--primary)', 10),
            boxShadow: `inset 0 0 0 1px ${mix('var(--primary)', 28)}`,
            animation: 'tm-up .2s ease',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              flexShrink: 0,
            }}
          >
            <Check size={12} strokeWidth={3} />
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--foreground)', lineHeight: 1.45 }}>
            {confirmText} — captured as a learning; the memory commit happens later, outside Teach.
          </span>
        </div>
      )}
    </div>
  );
}

const caption: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 9,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

function pill(colorVar: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 11px',
    borderRadius: 20,
    background: mix(colorVar, 14),
    boxShadow: `inset 0 0 0 1px ${mix(colorVar, 32)}`,
    color: colorVar,
    fontFamily: FONT_MONO,
    fontSize: 9.5,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  };
}

export default ConflictResolver;
