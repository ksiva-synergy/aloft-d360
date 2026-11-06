'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SENSITIVITY_LABEL, type LabelSource, type Sensitivity } from './api';
import s from './console.module.css';

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
