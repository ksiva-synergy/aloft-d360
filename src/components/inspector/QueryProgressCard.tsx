'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { TrustPanel } from './TrustPanel';
import type { QueryProgress } from '@/hooks/useInspectorChat';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const GOLD = '#FDB515';

const STAGE_ORDER: Array<QueryProgress['stage']> = ['planning', 'executing', 'rendering'];

const STAGE_COPY: Record<string, string> = {
  planning: 'Identifying relevant metrics…',
  executing: 'Running query against warehouse…',
  rendering: 'Building chart…',
};

/**
 * Progressive loading state for an in-flight semantic chart query (Phase 3A).
 *
 * Replaces the "spinner until done" with a staged reveal: the selected metrics
 * appear first, then the compiled SQL (in a TrustPanel preview) the moment it is
 * available — so the user has something meaningful to read within the first
 * second and can spot issues before the chart renders.
 */
export function QueryProgressCard({ progress }: { progress: QueryProgress }) {
  const activeIdx = progress.stage ? STAGE_ORDER.indexOf(progress.stage) : 0;

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(253,181,21,0.15)',
        borderRadius: 6,
        overflow: 'hidden',
        marginBottom: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid rgba(253,181,21,0.08)',
        }}
      >
        <Loader2 size={12} color={GOLD} className="query-progress-spin" />
        <span
          style={{
            ...MONO,
            fontSize: 10,
            letterSpacing: '0.06em',
            color: GOLD,
            textTransform: 'uppercase',
          }}
        >
          {STAGE_COPY[progress.stage ?? 'planning'] ?? 'Working…'}
        </span>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Stage stepper */}
        <div style={{ display: 'flex', gap: 6 }}>
          {STAGE_ORDER.map((stage, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            return (
              <div
                key={stage ?? i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background: done || active ? GOLD : 'rgba(74,96,128,0.3)',
                  opacity: active ? 1 : done ? 0.6 : 1,
                }}
              />
            );
          })}
        </div>

        {/* Selected definitions */}
        {progress.definitionsSelected && progress.definitionsSelected.length > 0 && (
          <div style={{ ...MONO, fontSize: 10, color: 'var(--wb-ink-dim, #B8C1CF)' }}>
            <span style={{ color: 'var(--wb-muted, #8892A4)' }}>Using: </span>
            {progress.definitionsSelected.join(', ')}
          </div>
        )}

        {/* Compiled SQL preview — appears before the chart renders */}
        {progress.compiledSQL && (
          <TrustPanel
            sql={progress.compiledSQL}
            defaultOpen
            summaryLabel="Compiled SQL (preview)"
          />
        )}
      </div>

      <style>{`
        @keyframes query-progress-spin { to { transform: rotate(360deg); } }
        .query-progress-spin { animation: query-progress-spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
