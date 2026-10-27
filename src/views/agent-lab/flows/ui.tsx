'use client';

import type { ReactNode } from 'react';
import { BookOpen, Database, Filter, Plug, Save, Sparkles, UserCheck, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';

// Small shared pieces for the Flows builder. Colours come from the shell tokens only.

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'brand';

const CHIP_TONE: Record<Tone, string> = {
  neutral: 'bg-[var(--surface-2)] text-[var(--ink-2)]',
  ok: 'bg-[var(--ok-bg)] text-[var(--ok)]',
  warn: 'bg-[var(--warn-bg)] text-[var(--warn)]',
  bad: 'bg-[var(--bad-bg)] text-[var(--bad)]',
  brand: 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]',
};

export function Chip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-size-caption font-medium', CHIP_TONE[tone], className)}>{children}</span>;
}

export const STEP_ICON: Record<string, typeof Database> = {
  query: Database,
  retrieve: BookOpen,
  agent: Sparkles,
  transform: Filter,
  approval: UserCheck,
  output: Save,
  tool: Plug,
};

const STEP_TILE: Record<string, string> = {
  agent: 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]',
  approval: 'bg-[var(--warn-bg)] text-[var(--warn)]',
};

export function StepIcon({ type, size = 'md' }: { type: string; size?: 'sm' | 'md' }) {
  const Icon = STEP_ICON[type] ?? Workflow;
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-lg', size === 'md' ? 'h-9 w-9' : 'h-6 w-6 rounded-md', STEP_TILE[type] ?? 'bg-[var(--surface-2)] text-[var(--ink-2)]')}>
      <Icon className={size === 'md' ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'} aria-hidden />
    </span>
  );
}

/** Rounded search / goal field: soft glow on focus, not a boxy inner outline. */
export const fieldShell =
  'flex items-center gap-2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-2)] px-3 transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-[color-mix(in_srgb,var(--brand-a)_50%,var(--line-1))] focus-within:bg-[var(--surface-1)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-a)_12%,transparent)]';
export const fieldInput =
  'min-w-0 w-full bg-transparent text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]';

export const btn = {
  primary: 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--brand-a)] px-3 text-size-ui font-semibold text-white hover:bg-[var(--brand-a-2)] disabled:opacity-60',
  secondary: 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--line-2)] bg-[var(--surface-1)] px-3 text-size-ui font-medium text-[var(--ink-1)] hover:bg-[var(--surface-2)] disabled:opacity-60',
  ghost: 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-size-ui font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] disabled:opacity-50',
  icon: 'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] disabled:opacity-30',
};

/** Segmented control (tabs styled as a pill group). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: NoInfer<T>; label: ReactNode }[]; onChange: (v: NoInfer<T>) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex rounded-lg bg-[var(--surface-2)] p-0.5 text-size-caption font-medium">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1', value === o.value ? 'bg-[var(--surface-1)] text-[var(--ink-1)] shadow-sm' : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const pretty = (v: unknown) => JSON.stringify(v, null, 2);
export const usd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
