'use client';

/**
 * LearningRail — the docked-right "What Marcus is learning" surface.
 *
 * Maps the normalized learnings map → cards, in first-seen order. Driven ONLY by
 * learning_item / verification_result events (never by scraping chat). Empty →
 * the dashed placeholder.
 */
import React from 'react';
import { Pencil } from 'lucide-react';
import type { Learning, LearningState } from '@/lib/inspector/reflect-tools';
import { FONT_MONO } from './teach-tokens';
import { LearningCard } from './LearningCard';

export function LearningRail({
  learnings,
  order,
  onResolve,
  onVerify,
}: {
  learnings: Record<string, Learning>;
  order: string[];
  onResolve: (learningId: string, nextState: LearningState) => void;
  onVerify?: (learning: Learning) => void;
}) {
  const cards = order.map((id) => learnings[id]).filter(Boolean);

  return (
    <aside
      style={{
        width: 408,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--muted)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Sticky header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          padding: '17px 18px 14px',
          background: 'color-mix(in srgb, var(--muted) 90%, transparent)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--primary)',
              boxShadow: '0 0 9px var(--primary)',
            }}
          />
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--foreground)' }}>
            What Marcus is learning
          </span>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', margin: '7px 0 0', lineHeight: 1.5 }}>
          Live-extracted learnings from this session. Reviewable now; committed to memory later.
        </p>
      </div>

      {/* Card list */}
      <div style={{ padding: '16px 16px 90px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {cards.length === 0 ? (
          <RailEmpty />
        ) : (
          cards.map((l) => (
            <LearningCard key={l.id} learning={l} onResolve={onResolve} onVerify={onVerify} />
          ))
        )}
      </div>
    </aside>
  );
}

function RailEmpty() {
  return (
    <div
      style={{
        border: '1px dashed var(--border)',
        borderRadius: 13,
        padding: '26px 18px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          margin: '0 auto 12px',
          borderRadius: 9,
          background: 'var(--muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
        }}
      >
        <Pencil size={16} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
        Nothing yet. As you teach Marcus, each learning appears here — tagged, tracked, and checked
        against the estate.
      </p>
    </div>
  );
}

export default LearningRail;
