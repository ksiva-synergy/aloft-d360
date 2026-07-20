'use client';

/**
 * MemoryRecallExpander — "recalled N related memories", expandable to the list.
 *
 * Drives off RelatedMemoryHit[] (recall_memory result, or a learning's
 * related_memory_hits). This is the visible payoff of the context-builder pin:
 * if recall is always empty against a populated org, that's the read-side signal
 * that retrieval isn't reaching the assembled prompt (build-plan seam 6).
 */
import React, { useState } from 'react';
import { RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import type { RelatedMemoryHit, ConflictInfo } from '@/lib/inspector/reflect-tools';
import { FONT_MONO } from './teach-tokens';

const PHASE_LABEL: Record<RelatedMemoryHit['phase'], string> = {
  INIT: 'Core rule',
  SCHEMA_GLOBAL: 'Memory',
  TASK_SCOPED: 'Memory',
};

export function MemoryRecallExpander({
  hits,
  conflict,
}: {
  hits: RelatedMemoryHit[];
  /** If a conflict was raised, its existing-memory id is flagged inline. */
  conflict?: ConflictInfo | null;
}) {
  const [open, setOpen] = useState(false);
  if (!hits.length) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 11, marginTop: 11 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          color: 'var(--primary)',
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
            boxShadow: 'inset 0 0 0 1.5px var(--primary)',
          }}
        >
          <RotateCcw size={9} />
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Recalled {hits.length} related {hits.length === 1 ? 'memory' : 'memories'}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 11, animation: 'tm-up .25s ease' }}>
          {hits.map((h) => {
            const conflicting = conflict?.existingMemoryId === h.id;
            return (
              <div
                key={h.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--muted)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', gap: 8 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      marginTop: 5,
                      flexShrink: 0,
                      background: conflicting ? 'var(--warning)' : 'var(--success)',
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--foreground)' }}>{h.ruleText}</div>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 8.5,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'var(--text-tertiary)',
                        marginTop: 5,
                      }}
                    >
                      {PHASE_LABEL[h.phase]} · {h.ruleType}
                      {conflicting && <span style={{ color: 'var(--warning)' }}> · now conflicting</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MemoryRecallExpander;
