'use client';

import React from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { TableBinding } from '@/lib/powerbi/report-lineage-graph';

export type LineageStatus = 'ready' | 'partial' | 'blocked' | 'failed' | 'none';

const STATUS_LABEL: Record<LineageStatus, string> = {
  ready: 'Ready', partial: 'Partial', blocked: 'Blocked', failed: 'Failed', none: 'Not run yet',
};

const STATUS_STYLE: Record<LineageStatus, string> = {
  ready: 'text-[var(--ok)] bg-[var(--ok-bg)]',
  partial: 'text-[var(--warn)] bg-[var(--warn-bg)]',
  blocked: 'text-[var(--bad)] bg-[var(--bad-bg)]',
  failed: 'text-[var(--bad)] bg-[var(--bad-bg)]',
  none: 'text-[var(--estate-text-muted)] bg-[var(--estate-active-bg)]',
};

export const STATUS_COLOR: Record<LineageStatus, string> = {
  ready: 'var(--ok)', partial: 'var(--warn)', blocked: 'var(--bad)', failed: 'var(--bad)', none: 'var(--lineage-unknown)',
};

export function asLineageStatus(value: string | null | undefined): LineageStatus {
  return value === 'ready' || value === 'partial' || value === 'blocked' || value === 'failed' ? value : 'none';
}

export function StatusPill({ status, title }: { status: LineageStatus; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-size-caption font-semibold', STATUS_STYLE[status])}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const CHIP = 'inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] border px-1.5 py-px text-size-caption font-medium';
const CHIP_NEUTRAL = 'border-[var(--estate-border)] bg-[var(--estate-active-bg)] text-[var(--estate-text-secondary)]';

export function Chip({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad'; title?: string; children: React.ReactNode }) {
  const toneCls = tone === 'ok' ? 'border-transparent bg-[var(--ok-bg)] text-[var(--ok)]'
    : tone === 'warn' ? 'border-transparent bg-[var(--warn-bg)] text-[var(--warn)]'
      : tone === 'bad' ? 'border-transparent bg-[var(--bad-bg)] text-[var(--bad)]' : CHIP_NEUTRAL;
  return <span title={title} className={cn(CHIP, toneCls)}>{children}</span>;
}

export function BindingChip({ binding }: { binding: TableBinding }) {
  switch (binding) {
    case 'bound': return <Chip tone="ok">UC bound</Chip>;
    case 'unbound': return <Chip tone="warn" title="Warehouse query with no Unity Catalog mapping yet">UC not bound</Chip>;
    case 'unknown': return <Chip tone="bad">source unknown</Chip>;
    case 'file': return <Chip title="File, site or feed: no Unity Catalog table expected">file · no UC</Chip>;
    case 'model': return <Chip title="Defined inside the semantic model">in model</Chip>;
    default: return <Chip title="Database source that is not a warehouse query">no UC</Chip>;
  }
}

export const BINDING_TEXT: Record<TableBinding, string> = {
  bound: 'Mapped to Unity Catalog by Catalog link',
  unbound: 'Warehouse query with no Unity Catalog mapping yet',
  file: 'File, site or feed: no Unity Catalog table expected',
  model: 'Defined inside the semantic model',
  unknown: 'Original source not traced',
  other: 'Database source that is not a warehouse query',
};

export async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`, { description: 'Select the text and copy it manually.' });
  }
}

export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={(event) => { event.stopPropagation(); void copyText(value, label); }}
      className={cn('inline-flex shrink-0 items-center rounded p-0.5 text-[var(--estate-text-dim)] hover:text-[var(--brand-a)]', className)}
    >
      <Copy className="size-3.5" aria-hidden />
    </button>
  );
}

/** Label / value rows; values are monospace, wrap anywhere, and can carry a copy button. */
export function ValueList({ rows }: { rows: Array<{ label: string; value: string | null | undefined; copy?: boolean }> }) {
  const visible = rows.filter((row) => row.value);
  if (!visible.length) return null;
  return (
    <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-caption">
      {visible.map((row) => (
        <React.Fragment key={row.label}>
          <dt className="text-[var(--estate-text-muted)]">{row.label}</dt>
          <dd className="flex min-w-0 items-start justify-between gap-1.5">
            <span className="min-w-0 whitespace-pre-wrap break-all font-mono text-size-caption text-[var(--estate-ink)]">{row.value}</span>
            {row.copy && <CopyButton value={row.value!} label={row.label} />}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-eyebrow uppercase text-[var(--estate-text-muted)]">{children}</p>;
}
