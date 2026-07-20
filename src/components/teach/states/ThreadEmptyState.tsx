'use client';

/**
 * ThreadEmptyState — the center-column "empty" state.
 *
 * "What should Marcus understand today?" + three seeded starter prompts. The
 * starters are static (they degrade gracefully — they do NOT depend on the
 * NL-intent /resolve substrate being live).
 */
import React from 'react';
import { FONT_BODY, FONT_DISPLAY, FONT_MONO } from '../teach-tokens';

const STARTERS = [
  "Here's what actually counts as ‘the fleet’.",
  'Let me explain how we define EEXI.',
  "‘Spar’ is an owner, not a ship class.",
];

export function ThreadEmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '40px 28px',
        animation: 'tm-up .4s ease',
      }}
    >
      {/* Gradient "M" tile */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
          color: 'var(--primary-foreground)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT_DISPLAY,
          fontSize: 26,
          fontWeight: 600,
          boxShadow: '0 4px 14px color-mix(in srgb, var(--primary) 30%, transparent)',
        }}
      >
        M
      </div>

      {/* Listening pill */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 18,
          padding: '3px 10px',
          borderRadius: 20,
          background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--primary) 32%, transparent)',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', animation: 'tm-pulse 1.8s ease-in-out infinite' }} />
        <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--primary)' }}>
          Reflect Mode · Marcus is listening
        </span>
      </span>

      {/* Headline */}
      <h1
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 40,
          fontWeight: 400,
          lineHeight: 1.12,
          letterSpacing: '-0.01em',
          color: 'var(--foreground)',
          margin: '20px 0 0',
          maxWidth: 560,
        }}
      >
        What should Marcus <span style={{ fontStyle: 'italic', color: 'var(--primary)' }}>understand</span> today?
      </h1>

      <p style={{ fontFamily: FONT_BODY, fontSize: 14.5, lineHeight: 1.6, color: 'var(--muted-foreground)', margin: '14px 0 0', maxWidth: 500 }}>
        Teach him a definition, a convention, or a piece of vocabulary. He&rsquo;ll ask questions,
        check the estate, and write down what he learns.
      </p>

      {/* Starters */}
      <div style={{ marginTop: 26, width: '100%', maxWidth: 460 }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
          Try starting with
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="tm-starter"
              style={{
                fontFamily: FONT_DISPLAY,
                fontStyle: 'italic',
                fontSize: 16,
                textAlign: 'left',
                padding: '14px 16px',
                borderRadius: 12,
                background: 'var(--card)',
                border: '1px solid var(--border)',
                boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)',
                color: 'var(--foreground)',
                cursor: 'pointer',
                transition: 'border-color .15s',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <style>{`.tm-starter:hover { border-color: color-mix(in srgb, var(--primary) 45%, transparent) !important; }`}</style>
    </div>
  );
}

export default ThreadEmptyState;
