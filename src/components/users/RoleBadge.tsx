'use client';

import { cn } from '@/lib/utils';
import { roleCopy } from './role-copy';

/** Per-role color — matches chips on the Users table. */
export const ROLE_BADGE_CLASS: Record<string, string> = {
  platform_admin:
    'text-[var(--brand-a-ink)] bg-[color-mix(in_srgb,var(--brand-a)_14%,transparent)] border-[color-mix(in_srgb,var(--brand-a)_35%,transparent)]',
  admin:
    'text-[var(--brand-b-ink)] bg-[var(--brand-b-soft)] border-[color-mix(in_srgb,var(--brand-b)_35%,transparent)]',
  member:
    'text-[var(--ink-2)] bg-[color-mix(in_srgb,var(--ink-3)_12%,transparent)] border-[color-mix(in_srgb,var(--ink-3)_28%,transparent)]',
  readonly:
    'text-[var(--ink-3)] bg-[color-mix(in_srgb,var(--ink-3)_8%,transparent)] border-[color-mix(in_srgb,var(--ink-3)_22%,transparent)]',
};

/** Dropdown menu row — strong enough to tell roles apart at a glance. */
export const ROLE_DROPDOWN_CARD: Record<string, string> = {
  platform_admin:
    'border-l-[var(--brand-a)] bg-[color-mix(in_srgb,var(--brand-a)_12%,var(--estate-surface))]',
  admin:
    'border-l-[var(--brand-b)] bg-[color-mix(in_srgb,var(--brand-b)_12%,var(--estate-surface))]',
  member:
    'border-l-[var(--ink-3)] bg-[color-mix(in_srgb,var(--ink-3)_10%,var(--estate-surface))]',
  readonly:
    'border-l-[color-mix(in_srgb,var(--ink-3)_35%,transparent)] bg-[var(--surface-2)]',
};

/** Second line in dropdown — accent per tier. */
export const ROLE_SUMMARY_ACCENT: Record<string, string> = {
  platform_admin: 'text-[var(--brand-a-ink)]',
  admin: 'text-[var(--brand-b-ink)]',
  member: 'text-[var(--ink-2)]',
  readonly: 'text-muted-foreground',
};

/** Left stripe + panel wash for the optional “about this role” block below the field. */
export const ROLE_PANEL_CLASS: Record<string, string> = {
  platform_admin:
    'border-l-[var(--brand-a)] bg-[color-mix(in_srgb,var(--brand-a)_8%,var(--estate-surface))]',
  admin:
    'border-l-[var(--brand-b)] bg-[color-mix(in_srgb,var(--brand-b)_8%,var(--estate-surface))]',
  member:
    'border-l-[var(--ink-3)] bg-[color-mix(in_srgb,var(--ink-3)_6%,var(--estate-surface))]',
  readonly:
    'border-l-[color-mix(in_srgb,var(--ink-3)_45%,transparent)] bg-[var(--surface-2)]',
};

interface RoleBadgeProps {
  role: string;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function RoleBadge({ role, label, size = 'md', className }: RoleBadgeProps) {
  const text = label ?? roleCopy(role).label;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded border font-semibold leading-none',
        size === 'sm' ? 'px-1.5 py-0.5 text-eyebrow normal-case tracking-normal' : 'px-2 py-0.5 text-size-ui',
        ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.readonly,
        className,
      )}
    >
      {text}
    </span>
  );
}
