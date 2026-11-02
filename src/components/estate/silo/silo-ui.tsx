'use client';

/**
 * Presentation pieces for the Silo Finder page: the 3-step
 * stepper, similarity meter, review-status pill and AI verdict tag.
 */

import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Stepper ──────────────────────────────────────────────────────────────────

const STEPS = ['Choose table', 'Search', 'Results'] as const;

export function SiloStepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Progress" className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  'h-px w-8 sm:w-12',
                  done || active ? 'bg-[var(--brand-a)]' : 'bg-[var(--estate-border)]',
                )}
              />
            )}
            <span className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-medium tabular-nums transition-colors',
                  active && 'border-[var(--brand-a)] bg-[var(--brand-a)] text-[var(--on-brand)]',
                  done && 'border-[var(--brand-a)] bg-transparent text-[var(--brand-a)]',
                  !active && !done && 'border-[var(--estate-border)] bg-[var(--estate-surface)] text-[var(--estate-text-muted)]',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={2.5} /> : n}
              </span>
              <span
                className={cn(
                  'text-label whitespace-nowrap',
                  active ? 'text-[var(--estate-ink)]' : done ? 'text-[var(--estate-text-secondary)]' : 'text-[var(--estate-text-muted)]',
                )}
              >
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Similarity meter ─────────────────────────────────────────────────────────

export function SimilarityMeter({ score }: { score: number | null | undefined }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(score ?? 0) * 100)));
  return (
    <div className="flex min-w-0 items-center gap-2.5" title={`Similarity score ${Number(score ?? 0).toFixed(2)}`}>
      <span className="w-9 shrink-0 text-right text-ui font-medium tabular-nums text-[var(--estate-ink)]">{pct}%</span>
      <span className="block h-1.5 w-full min-w-[56px] overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--estate-text-dim)_18%,transparent)]">
        <span
          className={cn('block h-full rounded-full', pct >= 85 ? 'bg-[var(--brand-a)]' : 'bg-[color:color-mix(in_srgb,var(--brand-a)_60%,transparent)]')}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

// ── Review status pill ───────────────────────────────────────────────────────

export function LinkStatusPill({ state }: { state: string }) {
  const base = 'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-caption font-medium';
  if (state === 'confirmed') {
    return (
      <span className={cn(base, 'border-transparent bg-[var(--ok-bg)] text-[var(--ok)]')}>
        <Check className="size-3" strokeWidth={2.5} /> Confirmed
      </span>
    );
  }
  if (state === 'rejected') {
    return <span className={cn(base, 'border-[var(--estate-border)] text-[var(--estate-text-muted)]')}>Not related</span>;
  }
  if (state === 'confirmed_loading' || state === 'rejected_loading') {
    return (
      <span className={cn(base, 'border-[var(--estate-border)] text-[var(--estate-text-secondary)]')}>
        <Loader2 className="size-3 animate-spin" />
        {state === 'confirmed_loading' ? 'Confirming' : 'Rejecting'}
      </span>
    );
  }
  return (
    <span className={cn(base, 'border-[color:color-mix(in_srgb,var(--brand-a)_35%,transparent)] bg-[var(--estate-active-bg)] text-[var(--estate-ink)]')}>
      To review
    </span>
  );
}

// ── AI verdict tag ───────────────────────────────────────────────────────────

const VERDICTS: Record<string, { label: string; dot: string }> = {
  silo: { label: 'Likely silo', dot: 'bg-[var(--bad)]' },
  duplicate: { label: 'Likely duplicate', dot: 'bg-[var(--brand-a)]' },
  related: { label: 'Related', dot: 'bg-[var(--ok)]' },
  unrelated: { label: 'Unrelated', dot: 'bg-[var(--estate-text-dim)]' },
};

export function VerdictTag({ verdict, confidence }: { verdict?: string | null; confidence?: number | null }) {
  if (!verdict) return null;
  const v = VERDICTS[verdict] ?? { label: verdict, dot: 'bg-[var(--estate-text-dim)]' };
  return (
    <span className="inline-flex items-center gap-1.5 text-label text-[var(--estate-ink)]">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', v.dot)} />
      {v.label}
      {confidence !== undefined && confidence !== null && (
        <span className="text-caption font-normal tabular-nums text-[var(--estate-text-muted)]">
          {Math.round(Number(confidence) * 100)}% sure
        </span>
      )}
    </span>
  );
}
