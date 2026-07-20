'use client';

import React from 'react';
import { PlugZap } from 'lucide-react';
import type { WidgetRenderState } from '@/lib/dashboards/widget-render-state';
import type { ChartKindGuess } from '@/lib/dashboards/guided-types';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const MUTED = '#8892A4';
const INK = 'var(--wb-ink, #E6ECF5)';
const AMBER = '#FDB515';

/**
 * The drill-in chart area.
 *
 * In THIS phase (the UI half) the only state it ever receives is
 * `awaiting_data` — and it renders that as an explicit, unmistakably-unfinished
 * panel: a hatched frame, a "NOT WIRED" tag, and copy that says live data comes
 * with the data half. It is deliberately NOT a chart and NOT an empty-result
 * card, so no one can screenshot the shell and call it done, and so a future
 * zero-row result (a real `empty`) can never be confused with "nothing ran yet".
 *
 * The other WidgetRenderState variants are handled with honest placeholders too
 * (they can't occur yet), so when the data half swaps in the real mapper the
 * switch is already exhaustive.
 */
export function NotWiredChart({
  state,
  chartKindGuess,
}: {
  state: WidgetRenderState;
  chartKindGuess?: ChartKindGuess;
}) {
  if (state.kind === 'awaiting_data') {
    return (
      <div
        data-testid="widget-chart-area"
        data-widget-render-state="awaiting_data"
        role="status"
        aria-label="Awaiting data — chart not yet wired"
        style={{
          flex: 1,
          minHeight: 220,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          borderRadius: 10,
          border: `1px dashed ${AMBER}55`,
          // Diagonal hatch = "scaffold, not a surface". Reads as unfinished on
          // sight, distinct from the solid fill a real chart/empty card uses.
          background:
            'repeating-linear-gradient(45deg, rgba(253,181,21,0.04) 0, rgba(253,181,21,0.04) 10px, transparent 10px, transparent 20px)',
        }}
      >
        <PlugZap size={22} color={AMBER} />
        <span
          style={{
            ...MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: AMBER, border: `1px solid ${AMBER}66`, borderRadius: 4, padding: '2px 7px',
          }}
        >
          Not wired
        </span>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 340 }}>
          <span style={{ ...MONO, fontSize: 12, color: INK, fontWeight: 600 }}>
            Awaiting data{chartKindGuess ? ` — will render as a ${chartKindGuess}` : ''}
          </span>
          <span style={{ ...MONO, fontSize: 10.5, color: MUTED, lineHeight: 1.5 }}>
            This is a spec, not a live chart. Live rendering arrives with the data layer — no query
            has run, so nothing here is real data yet.
          </span>
        </div>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return <PlaceholderPanel label="Loading…" tone={MUTED} />;
  }
  if (state.kind === 'empty') {
    return <PlaceholderPanel label="No rows for this query" tone={MUTED} />;
  }
  if (state.kind === 'model_not_governed') {
    return <PlaceholderPanel label={state.message || 'Publish this model to see live data'} tone={AMBER} />;
  }
  if (state.kind === 'error') {
    return <PlaceholderPanel label={state.message || 'Could not load data'} tone="#F87171" />;
  }
  // 'ok' — real rows. The live renderer is the data half; never fabricate one here.
  return <PlaceholderPanel label="Live chart renders with the data layer" tone={MUTED} />;
}

function PlaceholderPanel({ label, tone }: { label: string; tone: string }) {
  return (
    <div
      data-testid="widget-chart-area"
      style={{
        flex: 1, minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, borderRadius: 10, border: '1px solid rgba(136,146,164,0.2)', background: 'rgba(0,0,0,0.12)',
      }}
    >
      <span style={{ ...MONO, fontSize: 11, color: tone, textAlign: 'center', lineHeight: 1.5 }}>{label}</span>
    </div>
  );
}
