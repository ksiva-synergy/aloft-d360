'use client';

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, AlertTriangle, AlertOctagon, TrendingUp, CheckCircle2, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtPct, fmtUsd, type BudgetHealth } from '@/lib/spend/cost-derive';
import styles from './cost.module.css';

export function Card({ className, children, as: As = 'section', ...rest }: {
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
  'aria-labelledby'?: string;
}) {
  return (
    <As className={cn(styles.card, className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, id, hint, actions }: { title: ReactNode; id?: string; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 id={id} className="text-title-card text-[var(--ink-1)]">{title}</h2>
        {hint ? <p className="mt-0.5 text-caption text-[var(--ink-3)]">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Period-over-period change. Spend going up is not inherently bad, so this stays in ink, not status colors. */
export function Delta({ value, label = 'vs prior period' }: { value: number | null; label?: string }) {
  if (value == null) {
    return <span className="text-caption text-[var(--ink-3)]">No prior-period data</span>;
  }
  const flat = Math.abs(value) < 0.005;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-caption text-[var(--ink-2)]">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="font-medium tabular-nums">{flat ? '0%' : fmtPct(value)}</span>
      <span className="text-[var(--ink-3)]">{label}</span>
    </span>
  );
}

export function KpiTile({
  label,
  value,
  icon,
  delta,
  footer,
  children,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  delta?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn(styles.card, 'flex min-w-0 flex-col p-4')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-size-ui font-medium text-[var(--ink-2)]">{label}</span>
        {icon ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--ink-2)]">{icon}</span>
        ) : null}
      </div>
      <div className="mt-2 text-kpi-md tabular-nums text-[var(--ink-1)]">{value}</div>
      {delta ? <div className="mt-1">{delta}</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
      {footer ? <div className="mt-auto pt-3 text-caption text-[var(--ink-3)]">{footer}</div> : null}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  // T comes from `value` only, so string-literal unions are not widened by the options array.
  options: { value: NoInfer<T>; label: string }[];
  onChange: (v: NoInfer<T>) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] border border-[var(--line-1)] bg-[var(--surface-2)] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-lg font-medium transition-colors duration-hover',
              size === 'sm' ? 'px-2 py-0.5 text-caption' : 'px-3 py-1 text-size-ui',
              active
                ? 'bg-[var(--surface-1)] text-[var(--ink-1)] shadow-sm'
                : 'text-[var(--ink-3)] hover:text-[var(--ink-1)]',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SeriesSwatch({ series, className }: { series: 'ai' | 'harvest'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]', className)}
      style={{ background: series === 'ai' ? 'var(--cost-ai)' : 'var(--cost-harvest)' }}
    />
  );
}

/** Two-part bar (interactive + harvest) for a share of some maximum. 2px surface gap between parts. */
export function SplitBar({ ai, harvest, max, height = 6 }: { ai: number; harvest: number; max: number; height?: number }) {
  const safe = max > 0 ? max : 1;
  const aiPct = (ai / safe) * 100;
  const hvPct = (harvest / safe) * 100;
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-full" style={{ height }} aria-hidden>
      {aiPct > 0 ? <div className={styles.meterFill} style={{ width: `${aiPct}%`, background: 'var(--cost-ai)', borderRadius: 999 }} /> : null}
      {hvPct > 0 ? <div className={styles.meterFill} style={{ width: `${hvPct}%`, background: 'var(--cost-harvest)', borderRadius: 999 }} /> : null}
      <div className="flex-1 rounded-full bg-[var(--cost-track)]" />
    </div>
  );
}

export function RankedRow({
  label,
  sub,
  usd,
  count,
  share,
  series,
  onClick,
  countLabel = 'events',
}: {
  label: ReactNode;
  sub?: ReactNode;
  usd: number;
  count: number;
  /** 0..1 of the list's top value; drives bar length. */
  share: number;
  series: 'ai' | 'harvest';
  onClick?: () => void;
  countLabel?: string;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <SeriesSwatch series={series} />
          <span className="truncate text-size-ui text-[var(--ink-1)]">{label}</span>
          {sub ? <span className="truncate text-caption text-[var(--ink-3)]">{sub}</span> : null}
        </span>
        <span className="shrink-0 text-size-ui font-medium tabular-nums text-[var(--ink-1)]">{fmtUsd(usd)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--cost-track)]">
          <div
            className={cn(styles.meterFill, 'h-full rounded-full')}
            style={{ width: `${Math.max(share * 100, usd > 0 ? 1.5 : 0)}%`, background: series === 'ai' ? 'var(--cost-ai)' : 'var(--cost-harvest)' }}
          />
        </div>
        <span className="w-20 shrink-0 text-right text-caption tabular-nums text-[var(--ink-3)]">
          {count.toLocaleString()} {countLabel}
        </span>
      </div>
    </>
  );
  if (!onClick) return <li className="px-5 py-2.5">{body}</li>;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="block w-full px-5 py-2.5 text-left transition-colors duration-hover hover:bg-[var(--surface-2)]"
      >
        {body}
      </button>
    </li>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon ? <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--ink-3)]">{icon}</div> : null}
      <p className="text-size-ui font-medium text-[var(--ink-1)]">{title}</p>
      {children ? <div className="mt-1 max-w-md text-caption text-[var(--ink-3)]">{children}</div> : null}
    </div>
  );
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[var(--surface-3)]', className)} />;
}

const HEALTH: Record<BudgetHealth, { label: string; Icon: typeof AlertTriangle; cls: string }> = {
  exceeded: { label: 'Over budget', Icon: AlertOctagon, cls: 'bg-[var(--bad-bg)] text-[var(--bad)]' },
  alert: { label: 'Alert threshold', Icon: AlertTriangle, cls: 'bg-[var(--warn-bg)] text-[var(--warn)]' },
  'trending-over': { label: 'Trending over', Icon: TrendingUp, cls: 'bg-[var(--warn-bg)] text-[var(--warn)]' },
  ok: { label: 'On track', Icon: CheckCircle2, cls: 'bg-[var(--ok-bg)] text-[var(--ok)]' },
  'not-tracked': { label: 'Per-user cap', Icon: CircleDashed, cls: 'bg-[var(--surface-2)] text-[var(--ink-2)]' },
};

/** Status chip — always icon + label, never color alone. */
export function HealthBadge({ health }: { health: BudgetHealth }) {
  const h = HEALTH[health];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium', h.cls)}>
      <h.Icon className="h-3.5 w-3.5" aria-hidden />
      {h.label}
    </span>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium',
        tone === 'brand' ? 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]' : 'bg-[var(--surface-2)] text-[var(--ink-2)]',
      )}
    >
      {children}
    </span>
  );
}

/**
 * Resolves CSS custom properties to concrete colors for Recharts, which writes them as SVG
 * presentation attributes. Re-reads when the theme class on <html> changes.
 */
export function useCssColors<K extends string>(ref: RefObject<HTMLElement | null>, names: readonly K[], fallback: Record<K, string>): Record<K, string> {
  const [colors, setColors] = useState(fallback);
  const key = names.join('|');
  useEffect(() => {
    const read = () => {
      const el = ref.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      const next = {} as Record<K, string>;
      for (const n of names) next[n] = cs.getPropertyValue(n).trim() || fallback[n];
      setColors((prev) => (names.every((n) => prev[n] === next[n]) ? prev : next));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, key]);
  return colors;
}

export function Initials({ name }: { name: string }) {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const text = ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  return (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-a-soft)] text-caption font-semibold text-[var(--brand-a-ink)]">
      {text}
    </span>
  );
}
