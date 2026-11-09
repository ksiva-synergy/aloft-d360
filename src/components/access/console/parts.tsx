'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import userStyles from '@/components/users/users.module.css';
import { SENSITIVITY_LABEL, type LabelSource, type Sensitivity } from './api';
import s from './console.module.css';

export function ConsoleSelect({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  disabled,
  className,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          userStyles.selectTrigger,
          s.consoleSelect,
          'border-[var(--estate-btn-border)] bg-[var(--estate-surface)] text-[var(--estate-ink)] shadow-sm',
          'focus:shadow-none data-[state=open]:shadow-[none]',
          'focus:border-[color-mix(in_srgb,var(--brand-a)_55%,var(--estate-btn-border))]',
          'data-[state=open]:border-[var(--brand-a)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--brand-a)]/35 focus-visible:ring-offset-0',
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={cn(userStyles.selectMenu, 'min-w-[var(--radix-select-trigger-width)]')}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} className="text-size-ui">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LabelChip({
  label,
  inherited,
  title,
}: {
  label: Sensitivity;
  inherited?: boolean;
  title?: string;
}) {
  if (label === 'internal') return null;
  return (
    <span
      className={cn(
        s.chip,
        label === 'restricted' ? s.chipRestricted : s.chipConfidential,
        inherited && s.chipFaint,
      )}
      title={title}
    >
      {SENSITIVITY_LABEL[label]}
    </span>
  );
}

/** Label for a tree node: solid when set here, dashed when inherited from a parent. */
export function NodeLabelChip({ source }: { source: LabelSource }) {
  if (source.label === 'internal') return null;
  const inherited = source.own !== source.label;
  return (
    <LabelChip
      label={source.label}
      inherited={inherited}
      title={inherited && source.from ? `Inherited from ${source.from}` : 'Set on this path'}
    />
  );
}

export function ClearanceChip({ level }: { level: Sensitivity }) {
  if (level === 'internal') return <span className={s.chip}>Internal</span>;
  return <LabelChip label={level} />;
}

export type SegOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
  tone?: 'danger' | 'warn';
  disabled?: boolean;
};

export function Segmented<T extends string>({
  options,
  value,
  inherited,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: SegOption<T>[];
  value: T | null;
  /** Shown with a dashed outline: the effective value comes from a parent. */
  inherited?: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className={s.seg} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            disabled={disabled || o.disabled}
            className={cn(
              s.segBtn,
              active && s.segBtnActive,
              !active && inherited === o.value && s.segBtnInherited,
              o.tone === 'danger' && s.segBtnDanger,
              o.tone === 'warn' && s.segBtnWarn,
            )}
            onClick={() => {
              if (!active) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Card({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(s.card, className)}>
      <div className={s.cardHead}>
        <div>
          <h3 className={s.cardTitle}>{title}</h3>
          {hint ? <p className={s.cardHint}>{hint}</p> : null}
        </div>
        {actions}
      </div>
      <div className={s.cardBody}>{children}</div>
    </section>
  );
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.empty}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className={s.mono}>{children}</code>;
}

/** Smallest height the two-pane layout shrinks to; below this the page scrolls instead. */
const SPLIT_MIN_HEIGHT = 520;
const SPLIT_BOTTOM_GAP = 16;

/**
 * Two-pane layout that fills the window from where it starts to the bottom edge.
 * Re-measured on resize and when the content above it changes size. Stacked (natural height) on narrow screens.
 */
export function SplitPane({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const narrow = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 900px)') : null;
    const fit = () => {
      if (narrow?.matches) {
        el.style.height = '';
        return;
      }
      // Undo any scrolling so the measurement is the same wherever the page is scrolled.
      let scrolled = window.scrollY;
      for (let p = el.parentElement; p; p = p.parentElement) scrolled += p.scrollTop;
      const top = el.getBoundingClientRect().top + scrolled;
      el.style.height = `${Math.max(SPLIT_MIN_HEIGHT, Math.floor(window.innerHeight - top - SPLIT_BOTTOM_GAP))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    narrow?.addEventListener('change', fit);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (ro) {
      ro.observe(document.body);
      if (el.parentElement) ro.observe(el.parentElement);
    }
    return () => {
      window.removeEventListener('resize', fit);
      narrow?.removeEventListener('change', fit);
      ro?.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className={s.split}>
      {children}
    </div>
  );
}


/**
 * A remove action that asks "Sure?" first (no typing). It only narrows access, so no reason is needed.
 * Cancel puts the plain link back.
 */
export function ConfirmButton({ label, ariaLabel, disabled, className, onConfirm }: { label: string; ariaLabel?: string; disabled?: boolean; className?: string; onConfirm: () => Promise<unknown> | void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!asking) {
    return (
      <button type="button" className={cn(s.linkBtn, className)} aria-label={ariaLabel} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="text-caption text-muted-foreground">Sure?</span>
      <button
        type="button"
        className={s.linkBtn}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onConfirm();
            setAsking(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : label}
      </button>
      <button type="button" className={s.linkBtn} disabled={busy} onClick={() => setAsking(false)}>
        Cancel
      </button>
      {error ? <span className={s.errorText}>{error}</span> : null}
    </span>
  );
}
