'use client';

/**
 * Presentational pieces for the Mapper page (stepper, confidence bar,
 * status pill, progress list, notices). No data fetching lives here.
 */

import React from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const CARD = 'rounded-card border border-[var(--estate-border-gold)] bg-[var(--estate-raised)]';

// ── Stepper ──────────────────────────────────────────────────────────────────

const STEPS = ['Choose schemas', 'Find matches', 'Review'] as const;

export function MapperStepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <li aria-hidden className={cn('h-px w-10 shrink-0', done || active ? 'bg-[var(--brand-a)]' : 'bg-[var(--estate-border)]')} />
            )}
            <li className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-medium tabular-nums transition-colors',
                  active && 'border-[var(--brand-a)] bg-[var(--brand-a)] text-[var(--on-brand)]',
                  done && 'border-[var(--brand-a)] bg-transparent text-[var(--brand-a)]',
                  !active && !done && 'border-[var(--estate-border)] text-[var(--estate-text-muted)]',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={2.5} /> : n}
              </span>
              <span
                className={cn(
                  'text-label',
                  active ? 'text-[var(--estate-ink)]' : done ? 'text-[var(--estate-text-secondary)]' : 'text-[var(--estate-text-muted)]',
                )}
              >
                {label}
              </span>
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}

// ── Confidence ───────────────────────────────────────────────────────────────

export function formatPct(v: number | null | undefined): string {
  return `${Math.round((v ?? 0) * 100)}%`;
}

export function ConfidenceBar({ value, title }: { value: number | null; title?: string }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  const tone = v >= 0.85 ? 'bg-[var(--ok)]' : v >= 0.6 ? 'bg-[var(--warn)]' : 'bg-[var(--estate-text-dim)]';
  return (
    <span className="flex items-center gap-2" title={title}>
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--estate-text-dim)_18%,transparent)]">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${v * 100}%` }} />
      </span>
      <span className="w-9 text-right text-ui-regular tabular-nums text-[var(--estate-ink)]">{formatPct(v)}</span>
    </span>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────────

export function MappingStatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, { label: string; cls: string }> = {
    confirmed: { label: 'Confirmed', cls: 'bg-[var(--ok-bg)] text-[var(--ok)]' },
    rejected: { label: 'Rejected', cls: 'bg-[var(--bad-bg)] text-[var(--bad)]' },
    proposed: {
      label: 'Suggested',
      cls: 'border border-[var(--estate-border)] text-[var(--estate-text-secondary)]',
    },
  };
  const { label, cls } = map[s] ?? { label: status, cls: 'bg-[var(--estate-hover)] text-[var(--estate-text-secondary)]' };
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-caption font-medium', cls)}>
      {s === 'confirmed' && <Check className="size-3" strokeWidth={2.5} />}
      {label}
    </span>
  );
}

// ── Progress list ────────────────────────────────────────────────────────────

export interface StageRow {
  key: string;
  label: string;
  hint: string;
  status: 'checked' | 'current' | 'unchecked';
  durationMs?: number;
}

export function StageList({ stages }: { stages: StageRow[] }) {
  return (
    <ol className="flex flex-col">
      {stages.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
          {i < stages.length - 1 && (
            <span
              aria-hidden
              className={cn(
                'absolute bottom-1 left-[11px] top-7 w-px',
                s.status === 'checked' ? 'bg-[var(--brand-a)]' : 'bg-[var(--estate-border)]',
              )}
            />
          )}
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full border',
              s.status === 'checked' && 'border-[var(--brand-a)] bg-[var(--brand-a)] text-[var(--on-brand)]',
              s.status === 'current' && 'border-[var(--brand-a)] text-[var(--brand-a)]',
              s.status === 'unchecked' && 'border-[var(--estate-border)]',
            )}
          >
            {s.status === 'checked' ? (
              <Check className="size-3.5" strokeWidth={2.5} />
            ) : s.status === 'current' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
          </span>
          <div className="flex min-w-0 flex-1 items-start justify-between gap-4 pt-0.5">
            <div className="min-w-0">
              <div className={cn('text-ui', s.status === 'unchecked' ? 'text-[var(--estate-text-muted)]' : 'text-[var(--estate-ink)]')}>
                {s.label}
              </div>
              <div className="text-caption text-[var(--estate-text-muted)]">{s.hint}</div>
            </div>
            {s.durationMs !== undefined && (
              <span className="shrink-0 text-caption tabular-nums text-[var(--estate-text-muted)]">
                {(s.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Notices ──────────────────────────────────────────────────────────────────

export function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-ctl border border-[color:color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-3 py-2 text-ui-regular text-[var(--bad)]"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-caption font-medium text-[var(--estate-text-muted)]">
      {children}
    </label>
  );
}
