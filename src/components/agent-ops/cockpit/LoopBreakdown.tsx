'use client';

import React from 'react';
import type { TurnServerMetrics } from '@/lib/agent-ops/session-cockpit';
import { BORDER, WARN, fmtMs, fmtTokens, mono, pct, sans } from './format';

const LLM_COLOR = 'var(--brand-a)';
const TOOL_COLOR = WARN;
const CACHE_COLOR = '#14b8a6';

function fmtChars(n: number): string {
  // ~4 chars per token is a fair rough guide for English + JSON.
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k chars (~${fmtTokens(Math.round(n / 4))} tok)` : `${n} chars`;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

/** Per-LLM-call view of one turn: model vs tool time, context growth, cache hits. */
export function LoopBreakdown({ server }: { server: TurnServerMetrics }) {
  const loops = server.loopMetrics;
  if (loops.length === 0) {
    return <p style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: 'var(--ink-3)', margin: 0 }}>No loop rows recorded for this turn.</p>;
  }
  const maxTime = Math.max(...loops.map((l) => l.llmMs + l.toolMs), 1);
  const maxCtx = Math.max(...loops.map((l) => l.contextChars), 1);
  const overhead = Math.max(server.durationMs - server.llmMs - server.toolMs, 0);

  return (
    <div>
      {/* turn summary bar */}
      <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 }}>
        <span title={`Model ${fmtMs(server.llmMs)}`} style={{ flex: Math.max(server.llmMs, 1), background: LLM_COLOR }} />
        <span title={`Tools ${fmtMs(server.toolMs)}`} style={{ flex: Math.max(server.toolMs, 1), background: TOOL_COLOR }} />
        {overhead > 0 && <span title={`Other (prompt build, scoring) ${fmtMs(overhead)}`} style={{ flex: overhead, background: 'var(--wb-border-subtle)' }} />}
      </div>
      <div style={{ ...sans, display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', marginTop: 8 }}>
        <Legend color={LLM_COLOR} label={`Model ${fmtMs(server.llmMs)} (${pct(server.llmMs, server.durationMs)})`} />
        <Legend color={TOOL_COLOR} label={`Tools ${fmtMs(server.toolMs)} (${pct(server.toolMs, server.durationMs)})`} />
        {overhead > 0 && <Legend color="var(--wb-border-subtle)" label={`Other ${fmtMs(overhead)}`} />}
        <span>
          Total <strong style={{ color: 'var(--wb-ink)' }}>{fmtMs(server.durationMs)}</strong>
          {server.firstTokenMs != null && <> · first token {fmtMs(server.firstTokenMs)}</>}
        </span>
      </div>

      {/* header */}
      <div
        style={{
          ...sans,
          display: 'grid',
          gridTemplateColumns: '56px minmax(0, 2fr) minmax(0, 1.4fr) 150px',
          gap: 12,
          fontSize: 'var(--type-caption-size)',
          color: 'var(--ink-3)',
          padding: '16px 4px 6px',
          borderBottom: BORDER,
        }}
      >
        <span>Loop</span>
        <span>Time — model vs tools</span>
        <span>Context sent</span>
        <span style={{ textAlign: 'right' }}>Input tokens · cached</span>
      </div>

      {loops.map((l) => {
        const cachedShare = l.inputTokens > 0 ? l.cacheReadTokens / l.inputTokens : 0;
        return (
          <div
            key={l.loop}
            style={{
              display: 'grid',
              gridTemplateColumns: '56px minmax(0, 2fr) minmax(0, 1.4fr) 150px',
              gap: 12,
              alignItems: 'center',
              padding: '10px 4px',
              borderBottom: BORDER,
            }}
          >
            <span style={{ ...mono, fontSize: 'var(--type-caption-size)', color: 'var(--brand-a)' }}>#{l.loop}</span>

            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'flex', height: 10, width: `${((l.llmMs + l.toolMs) / maxTime) * 100}%`, minWidth: 4, borderRadius: 3, overflow: 'hidden' }}>
                <span style={{ flex: Math.max(l.llmMs, 1), background: LLM_COLOR }} />
                {l.toolMs > 0 && <span style={{ flex: l.toolMs, background: TOOL_COLOR }} />}
              </span>
              <span style={{ ...mono, display: 'block', fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', marginTop: 4 }}>
                model {fmtMs(l.llmMs)}
                {l.firstTokenMs != null && ` (1st token ${fmtMs(l.firstTokenMs)})`}
                {l.toolMs > 0 && ` · ${l.toolCalls} tool${l.toolCalls === 1 ? '' : 's'} ${fmtMs(l.toolMs)}`}
                {l.stopReason === 'end_turn' && ' · answered'}
              </span>
            </span>

            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', height: 6, borderRadius: 3, background: 'var(--wb-border-subtle)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(l.contextChars / maxCtx) * 100}%`, background: 'var(--brand-b)' }} />
              </span>
              <span style={{ ...mono, display: 'block', fontSize: 'var(--type-caption-size)', color: 'var(--ink-3)', marginTop: 4 }}>
                {fmtChars(l.contextChars)} · {l.contextMessages} msgs
              </span>
            </span>

            <span style={{ textAlign: 'right' }}>
              <span style={{ ...mono, display: 'block', fontSize: 'var(--type-caption-size)', color: 'var(--wb-ink)' }}>{fmtTokens(l.inputTokens)}</span>
              <span style={{ ...mono, display: 'block', fontSize: 'var(--type-caption-size)', color: l.cacheReadTokens > 0 ? CACHE_COLOR : 'var(--ink-3)', marginTop: 2 }}>
                {l.cacheReadTokens > 0 ? `${fmtTokens(l.cacheReadTokens)} cached (${Math.round(cachedShare * 100)}%)` : 'no cache hit'}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
