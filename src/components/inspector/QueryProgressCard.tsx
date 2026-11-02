'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { TrustPanel } from './TrustPanel';
import type { QueryProgress } from '@/hooks/useInspectorChat';
import { type } from '@/lib/typography/tokens';

const STAGES: Array<{ id: NonNullable<QueryProgress['stage']>; label: string; active: string }> = [
  { id: 'planning', label: 'Pick metrics', active: 'Identifying relevant metrics' },
  { id: 'executing', label: 'Query warehouse', active: 'Running query against warehouse' },
  { id: 'rendering', label: 'Build chart', active: 'Building chart' },
];

const CHART_BARS = [42, 68, 52, 84, 60, 92, 74];

/**
 * Progressive loading state for an in-flight semantic chart query (Phase 3A).
 *
 * Replaces the "spinner until done" with a staged reveal: a step timeline, the
 * selected metrics as chips, then the compiled SQL (in a TrustPanel preview) the
 * moment it is available, and a skeleton chart while the query runs — so the user
 * has something meaningful to read within the first second.
 */
export function QueryProgressCard({ progress }: { progress: QueryProgress }) {
  const activeIdx = Math.max(0, STAGES.findIndex(s => s.id === (progress.stage ?? 'planning')));
  const current = STAGES[activeIdx];
  const metrics = progress.definitionsSelected ?? [];

  return (
    <div className="ld-card" style={{ marginBottom: 12 }}>
      <div className="ld-bar" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }} role="status" aria-live="polite">
        <span className="ld-dot" />
        <span key={current.id} className="ld-shimmer-text" style={{ ...type['ui-regular'], fontWeight: 500 }}>
          {current.active}
        </span>
        <span style={{ ...type['ui-regular'], marginLeft: 'auto', color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
          {activeIdx + 1}/{STAGES.length}
        </span>
      </div>

      <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ol className="ld-steps">
          {STAGES.map((stage, i) => {
            const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
            return (
              <li key={stage.id} className="ld-step" data-state={state}>
                <div className="ld-step-row">
                  <span className="ld-step-mark">
                    {state === 'done' ? <Check size={10} strokeWidth={3} /> : state === 'active' ? <span className="ld-dot" /> : null}
                  </span>
                  <span style={type['ui-regular']}>{stage.label}</span>
                </div>
                {stage.id === 'planning' && metrics.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 6px 27px' }}>
                    {metrics.map((m, j) => (
                      <span key={m} className="ld-chip" style={{ fontFamily: 'var(--font-mono)', animationDelay: `${j * 50}ms` }}>{m}</span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Compiled SQL preview — appears before the chart renders */}
        {progress.compiledSQL && (
          <TrustPanel
            sql={progress.compiledSQL}
            defaultOpen
            summaryLabel="Compiled SQL (preview)"
          />
        )}

        {activeIdx >= 1 && (
          <div className="ld-chart" aria-hidden>
            {CHART_BARS.map((h, i) => (
              <span key={i} className="ld-skel" style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
