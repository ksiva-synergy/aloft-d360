'use client';

import React from 'react';
import { Play, X } from 'lucide-react';
import { CATALOG_BTN, CATALOG_BTN_PRIMARY, OverflowMenu, type MenuItem } from './catalog-ui';

interface BulkActionBarProps {
  count: number;
  onHarvest: () => void;
  onSchedule?: () => void;
  onUnschedule?: () => void;
  onScheduleCatalog?: (action: 'include' | 'exclude') => void;
  onRunPipeline?: () => void;
  onRunScheduled?: () => void;
  pipelineRunning?: boolean;
  scheduledRunning?: boolean;
  catalogScope?: string;
  /** Objects in the current scope (shown next to the scope name). */
  scopeTotal?: number;
  onClear: () => void;
  /** When false, only selection count / scope label — no harvest, schedule, or pipeline actions. */
  canRunPipeline?: boolean;
}

/**
 * One line above the table. Selected rows → bulk actions. Otherwise, when a
 * catalog/schema is picked in the tree → scope header with one primary action
 * and the rest in an overflow menu.
 */
export default function BulkActionBar({
  count,
  onHarvest,
  onSchedule,
  onUnschedule,
  onScheduleCatalog,
  onRunPipeline,
  onRunScheduled,
  pipelineRunning = false,
  scheduledRunning = false,
  catalogScope,
  scopeTotal,
  onClear,
  canRunPipeline = false,
}: BulkActionBarProps) {
  if (count === 0 && !catalogScope) return null;

  if (count > 0) {
    return (
      <div className="mx-6 mb-2 flex flex-wrap items-center gap-2 rounded-card border border-[color:color-mix(in_srgb,var(--brand-a)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand-a)_6%,transparent)] px-3 py-2">
        <span className="text-ui font-medium text-[var(--estate-ink)]">{count} selected</span>
        {canRunPipeline ? (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-[var(--estate-border)]" />
            <button type="button" onClick={onHarvest} className={CATALOG_BTN_PRIMARY} title="Run the structural scan (T0) now for the selected objects">
              Scan now
            </button>
            {onSchedule && (
              <button type="button" onClick={onSchedule} className={`${CATALOG_BTN} h-8`} title="Include in the next scheduled scan">
                Add to schedule
              </button>
            )}
            {onUnschedule && (
              <button type="button" onClick={onUnschedule} className={`${CATALOG_BTN} h-8`} title="Exclude from scheduled scans">
                Remove from schedule
              </button>
            )}
          </>
        ) : (
          <span className="text-ui-regular text-[var(--estate-text-muted)]">Platform admin required to run scan actions</span>
        )}
        <button type="button" onClick={onClear} className="ml-auto inline-flex items-center gap-1 rounded-xs px-1.5 py-1 text-label text-[var(--estate-text-muted)] hover:text-[var(--estate-ink)]">
          <X className="size-3.5" /> Clear
        </button>
      </div>
    );
  }

  const menu: MenuItem[] = [];
  if (onRunScheduled) {
    menu.push({
      label: scheduledRunning ? 'Starting\u2026' : 'Run scheduled now',
      hint: 'Start the pipeline for tables already on the schedule',
      onSelect: onRunScheduled,
      disabled: scheduledRunning,
    });
  }
  if (onScheduleCatalog) {
    menu.push(
      { label: 'Add all to schedule', hint: 'Mark every object here for the next scheduled scan', onSelect: () => onScheduleCatalog('include') },
      { label: 'Remove all from schedule', hint: 'Exclude every object here from scheduled scans', onSelect: () => onScheduleCatalog('exclude'), danger: true },
    );
  }

  return (
    <div className="mx-6 mb-2 flex flex-wrap items-center gap-2 border-b border-[var(--estate-border)] pb-2.5">
      <div className="min-w-0 flex-1">
        <span className="font-mono text-ui text-[var(--estate-ink)]">{catalogScope}</span>
        {scopeTotal !== undefined && (
          <span className="ml-2 text-ui-regular text-[var(--estate-text-muted)]">
            {scopeTotal.toLocaleString()} object{scopeTotal === 1 ? '' : 's'}
          </span>
        )}
        {!canRunPipeline && <span className="ml-2 text-caption text-[var(--estate-text-muted)]">(view only)</span>}
      </div>
      {canRunPipeline && onRunPipeline && (
        <button
          type="button"
          disabled={pipelineRunning}
          onClick={onRunPipeline}
          className={CATALOG_BTN_PRIMARY}
          title={'T0 \u2192 T1 \u2192 T2 \u2192 embed, in order, for everything in this scope'}
        >
          <Play className="size-3.5" />
          {pipelineRunning ? 'Launching\u2026' : 'Run full pipeline'}
        </button>
      )}
      {canRunPipeline && <OverflowMenu items={menu} label="More scope actions" />}
    </div>
  );
}