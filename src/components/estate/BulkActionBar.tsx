'use client';

import React from 'react';
import { type } from '@/lib/typography/tokens';

interface BulkActionBarProps {
  count: number;
  onHarvest: () => void;
  onSchedule?: () => void;
  onUnschedule?: () => void;
  onScheduleCatalog?: (action: 'include' | 'exclude') => void;
  onRunPipeline?: () => void;
  pipelineRunning?: boolean;
  catalogScope?: string;
  onClear: () => void;
}

export default function BulkActionBar({
  count,
  onHarvest,
  onSchedule,
  onUnschedule,
  onScheduleCatalog,
  onRunPipeline,
  pipelineRunning = false,
  catalogScope,
  onClear,
}: BulkActionBarProps) {
  const goldColor = 'var(--brand-a)';
  const goldDim = '#9a7a2a';
  const blueColor = '#60a5fa';
  const blueDim = 'rgba(96, 165, 250, 0.35)';

  const btnBase: React.CSSProperties = {
    ...type.label,
    padding: '6px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
  };

  if (count === 0 && !catalogScope) return null;

  return (
    <div
      className="flex items-center gap-3 mx-6 mt-2 px-4 py-2.5 rounded-md flex-wrap"
      style={{
        background: count > 0 ? 'color-mix(in srgb, var(--brand-a) 8%, transparent)' : 'rgba(96, 165, 250, 0.06)',
        border: `1px solid ${count > 0 ? goldDim : blueDim}`,
      }}
    >
      {count > 0 && (
        <>
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-ui-regular-size)', color: goldColor, letterSpacing: '0.04em' }}
          >
            {count} selected
          </span>

          <button type="button" onClick={onHarvest} style={{ ...btnBase, background: goldColor, color: 'var(--estate-bg)', border: `1px solid ${goldColor}` }}>
            ⛏ Harvest
          </button>

          {onSchedule && (
            <button type="button" onClick={onSchedule} style={{ ...btnBase, background: 'transparent', color: blueColor, border: `1px solid ${blueDim}` }}>
              + Schedule
            </button>
          )}

          {onUnschedule && (
            <button type="button" onClick={onUnschedule} style={{ ...btnBase, background: 'transparent', color: 'var(--estate-text-muted)', border: `1px solid var(--estate-btn-border)` }}>
              − Unschedule
            </button>
          )}
        </>
      )}

      {catalogScope && count === 0 && (onScheduleCatalog || onRunPipeline) && (
        <>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-ui-regular-size)', color: 'var(--estate-text-secondary)', letterSpacing: '0.04em' }}>
            Scope: <strong style={{ color: blueColor }}>{catalogScope}</strong>
          </span>
          {onRunPipeline && (
            <button
              type="button"
              disabled={pipelineRunning}
              onClick={onRunPipeline}
              title="Runs T0 structural → T1 profile → T2 semantic on Fargate (sequential), scoped with Limit"
              style={{
                ...btnBase,
                background: goldColor,
                color: 'var(--estate-bg)',
                border: `1px solid ${goldColor}`,
                opacity: pipelineRunning ? 0.6 : 1,
              }}
            >
              {pipelineRunning ? 'Launching…' : 'Run pipeline now'}
            </button>
          )}
          {onScheduleCatalog && (
            <>
              <button
                type="button"
                onClick={() => onScheduleCatalog('include')}
                style={{ ...btnBase, background: 'transparent', color: blueColor, border: `1px solid ${blueDim}` }}
                title="Marks discovery rows for scheduled harvest (does not start T0–T2 immediately)"
              >
                + Schedule all
              </button>
              <button
                type="button"
                onClick={() => onScheduleCatalog('exclude')}
                style={{ ...btnBase, background: 'transparent', color: 'var(--estate-text-muted)', border: '1px solid var(--estate-btn-border)' }}
              >
                − Unschedule all
              </button>
            </>
          )}
        </>
      )}

      <span
        onClick={onClear}
        className="ml-auto cursor-pointer transition-colors"
        style={{
          ...type.label,
          color: 'var(--estate-text-muted)',
          display: count > 0 ? undefined : 'none',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = goldColor; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--estate-text-muted)'; }}
      >
        Clear
      </span>
    </div>
  );
}
