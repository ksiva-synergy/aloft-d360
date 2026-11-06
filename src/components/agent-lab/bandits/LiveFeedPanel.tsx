'use client';

import React, { useRef, useEffect } from 'react';
import type { RecentRun } from './types';
import {
  BORDER, GOLD,
  TEXT_PRI, TEXT_MUT,
  MONO,
  modelColor,
} from '@/lib/bandits/born-tokens';
import { shortName } from '@/lib/bandits/born-tokens';
import { type, inkOf } from '@/lib/typography/tokens';
import { CtsgvMicroBar } from './CtsgvMicroBar';
import { PanelHeader, PANEL_PADDING } from './PanelHeader';

const FEED_GRID = '18px minmax(0, 1fr) 76px 56px 56px 52px 64px';

import { withAlpha } from '@/lib/theme/with-alpha';
function stripPrefix(s: string): string {
  if (!s) return s;
  if (s === 'inspector_chat') return 'inspector';
  if (s.startsWith('boost_')) return 'boost:' + s.slice(6);
  if (s.startsWith('workbench_')) return 'wb:' + s.slice(10);
  return s;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDuration(ms: number | undefined): string {
  if (!ms && ms !== 0) return '--';
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtTokens(n: number | undefined | null): string {
  if (n == null) return '--';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function qualityColor(v: number | null | undefined): string {
  if (v == null) return TEXT_MUT;
  if (v >= 0.85) return '#4ADE80';
  if (v >= 0.70) return '#6BC5B0';
  if (v >= 0.55) return '#E8A838';
  return '#D4605A';
}

function sourceConfig(src: string): { bg: string; color: string; label: string } {
  if (src === 'boost' || src?.startsWith('boost'))
    return { bg: 'rgba(107,197,176,0.08)', color: '#6BC5B0', label: 'Boost' };
  if (src === 'inspector')
    return { bg: 'rgba(108,155,210,0.08)', color: '#6C9BD2', label: 'Inspector' };
  if (src === 'workbench')
    return { bg: 'rgba(167,127,196,0.08)', color: '#A77FC4', label: 'Workbench' };
  if (src === 'pipeline' || src === 'compiled_pipeline')
    return { bg: 'rgba(232,168,56,0.08)', color: '#E8A838', label: 'Pipeline' };
  if (src === 'lab_single')
    return { bg: 'rgba(142,159,170,0.08)', color: '#8E9FAA', label: 'Lab' };
  if (src === 'lab_graph')
    return { bg: 'rgba(142,159,170,0.08)', color: '#8E9FAA', label: 'Lab·G' };
  return { bg: 'rgba(142,159,170,0.06)', color: TEXT_MUT, label: src };
}

const ANIM_STYLE = `
@keyframes feedSlideIn {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes pulseDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.5); }
}
.born-feed-row-new {
  animation: feedSlideIn 350ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
`;

function InjectStyle() {
  useEffect(() => {
    const id = 'born-feed-anim-v2';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = ANIM_STYLE;
      document.head.appendChild(style);
    }
  }, []);
  return null;
}

interface Props {
  recentRuns: RecentRun[];
  favId: string;
}

export function LiveFeedPanel({ recentRuns, favId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  useEffect(() => {
    if (!initialScrollDone.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      initialScrollDone.current = true;
    }
  }, [recentRuns]);

  return (
    <div className="born-card" style={{ padding: PANEL_PADDING }}>
      <InjectStyle />

      <PanelHeader
        title="Recent Runs"
        meta={recentRuns.length > 0 ? `${recentRuns.length} most recent` : undefined}
        subtitle="Newest first · refreshes with the filters above"
      />

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: FEED_GRID,
        gap: 8,
        padding: '0 0 8px 0',
        borderBottom: `1px solid ${BORDER}`,
        marginBottom: 4,
      }}>
        {['', 'Task · model', 'When', 'Dur', 'Tokens', 'Score', 'CTSGV'].map((h, i) => (
          <span key={i} style={{
            ...type.eyebrow, color: TEXT_MUT,
            textAlign: i > 1 ? 'right' : 'left',
            whiteSpace: 'nowrap',
          }}>
            {h}
          </span>
        ))}
      </div>

      {/* Scrollable list */}
      <div
        ref={scrollRef}
        style={{
          maxHeight: 440,
          overflowY: 'auto',
        }}
      >
        {recentRuns.length === 0 ? (
          <div style={{
            padding: '40px 0', textAlign: 'center',
            ...type.caption, color: TEXT_MUT,
          }}>
            No runs recorded yet.
          </div>
        ) : (
          recentRuns.map((run, idx) => {
            const isCompleted = run.status === 'completed' || run.status === 'success';
            const isErrored = run.status === 'errored' || run.status === 'failed' || run.status === 'error';

            const taskName = stripPrefix(run.sheet_type || run.sheet_id || '');
            const modelId = run.model_id || run.agent_id || '';
            const modelDisplay = shortName(modelId);
            const durationMs = run.duration_ms ?? run.total_duration_ms;
            const tokens = (run.input_tokens != null && run.output_tokens != null)
              ? run.input_tokens + run.output_tokens
              : run.total_tokens ?? null;
            const composite = run.composite_score ?? run.quality_score;
            const isFavRun = modelId === favId;
            const srcConfig = run.source ? sourceConfig(String(run.source)) : null;

            return (
              <div
                key={run.id}
                className={idx === 0 ? 'born-feed-row-new' : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: FEED_GRID,
                  gap: 8,
                  alignItems: 'center',
                  minHeight: 48,
                  borderBottom: '1px solid var(--born-overlay-2)',
                  padding: '8px 0',
                  transition: 'background 0.15s ease',
                  cursor: 'default',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--born-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Status icon */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {isCompleted ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" stroke="#4ADE80" strokeWidth="1.2" opacity="0.3" />
                      <path d="M4.5 7L6.2 8.7L9.5 5.3" stroke="#4ADE80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : isErrored ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" stroke="#D4605A" strokeWidth="1.2" opacity="0.3" />
                      <path d="M5 5L9 9M9 5L5 9" stroke="#D4605A" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" stroke="#E8A838" strokeWidth="1.2" opacity="0.3" />
                      <path d="M7 4V7.5L9 9" stroke="#E8A838" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

                {/* Task + source, with the model that ran underneath */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{
                      ...type.caption, fontFamily: MONO,
                      color: TEXT_PRI,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontWeight: 500,
                    }} title={taskName || modelDisplay}>
                      {taskName || modelDisplay}
                    </span>
                    {srcConfig && (
                      <span style={{
                        ...type.caption,
                        padding: '0 6px', borderRadius: 999,
                        flexShrink: 0,
                        background: srcConfig.bg,
                        color: inkOf(srcConfig.color, 70),
                        border: `1px solid ${withAlpha(srcConfig.color, '30')}`,
                      }}>
                        {srcConfig.label}
                      </span>
                    )}
                  </div>
                  {taskName && modelId && (
                    <span title={modelId} style={{
                      ...type.caption, fontFamily: MONO, color: isFavRun ? inkOf(GOLD, 70) : TEXT_MUT,
                      display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: isFavRun ? GOLD : modelColor(modelId),
                      }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {modelDisplay}
                      </span>
                    </span>
                  )}
                </div>

                {/* Time ago */}
                <span style={{
                  ...type.caption, fontFamily: MONO, color: TEXT_MUT,
                  textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                }}>
                  {run.created_at ? timeAgo(run.created_at) : '--'}
                </span>

                {/* Duration */}
                <span style={{ ...type.caption, fontFamily: MONO, color: TEXT_MUT, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtDuration(durationMs)}
                </span>

                {/* Tokens */}
                <span style={{ ...type.caption, fontFamily: MONO, color: TEXT_MUT, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtTokens(tokens)}
                </span>

                {/* Composite score */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    ...type.caption, fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
                    color: composite != null ? inkOf(qualityColor(composite), 75) : TEXT_MUT,
                    fontWeight: composite != null ? 600 : 400,
                    padding: composite != null && composite >= 0.85 ? '1px 4px' : undefined,
                    background: composite != null && composite >= 0.85 ? 'rgba(74,222,128,0.08)' : undefined,
                    borderRadius: 999,
                  }}>
                    {composite != null ? composite.toFixed(2) : '--'}
                  </span>
                </div>

                {/* CTSGV micro-bar */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <CtsgvMicroBar scores={run} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
