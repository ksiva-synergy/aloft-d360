'use client';

/**
 * SessionHeader — sticky top of the center column.
 *
 * Shows the always-on Reflect indicator, the topic being taught, and four live
 * counters DERIVED from the learnings map (one source of truth — no drift with
 * the visible cards).
 */
import React from 'react';
import type { TeachCounters } from '@/hooks/useTeachChat';
import { FONT_DISPLAY, FONT_MONO } from './teach-tokens';

export function SessionHeader({ topic, counters }: { topic: string | null; counters: TeachCounters }) {
  const tiles: { n: number; label: string; color: string }[] = [
    { n: counters.proposed, label: 'Proposed', color: 'var(--primary)' },
    { n: counters.verified, label: 'Verified', color: 'var(--success)' },
    { n: counters.pending, label: 'Pending', color: 'var(--muted-foreground)' },
    { n: counters.conflicts, label: 'Conflicts', color: 'var(--warning)' },
  ];

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        padding: '16px 28px 14px',
        background: 'color-mix(in srgb, var(--background) 88%, transparent)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 20,
        flexWrap: 'wrap',
      }}
    >
      {/* Left — Reflect pill + topic */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Teach Session
          </span>
          <ReflectPill />
        </div>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 25,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--foreground)',
            margin: '6px 0 0',
            lineHeight: 1.2,
          }}
        >
          {topic || 'What should Marcus understand?'}
        </h1>
      </div>

      {/* Right — counters */}
      <div style={{ display: 'flex', gap: 8 }}>
        {tiles.map((t) => (
          <div
            key={t.label}
            style={{
              textAlign: 'center',
              padding: '7px 14px',
              borderRadius: 11,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              minWidth: 64,
            }}
          >
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, lineHeight: 1, color: t.color }}>
              {t.n}
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginTop: 5 }}>
              {t.label}
            </div>
          </div>
        ))}
      </div>
    </header>
  );
}

export function ReflectPill() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 20,
        background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--primary) 32%, transparent)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', animation: 'tm-pulse 1.8s ease-in-out infinite' }} />
      <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--primary)' }}>
        Reflect · Learning, not executing
      </span>
    </span>
  );
}

export default SessionHeader;
