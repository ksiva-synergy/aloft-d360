'use client';

import { cn } from '@/lib/utils';
import { roleCopy } from './role-copy';

/** Per-role color — matches chips on the Users table. */
export const ROLE_BADGE_CLASS: Record<string, string> = {
  platform_admin:
    'text-[var(--brand-a-ink)] dark:text-[var(--brand-a-ink)] bg-[color-mix(in_srgb,var(--brand-a)_14%,transparent)] border-[color-mix(in_srgb,var(--brand-a)_35%,transparent)]',
  admin:
    'text-[var(--brand-a-ink)] dark:text-[#5B9DFF] bg-[var(--brand-a-ink)]/[0.09] dark:bg-[#5B9DFF]/12 border-[color-mix(in_srgb,var(--brand-a-ink)_22%,transparent)] dark:border-[#5B9DFF]/30',
  member:
    'text-[#4A5A6A] dark:text-[var(--ink-3)] bg-[color-mix(in_srgb,var(--ink-3)_12%,transparent)] border-[color-mix(in_srgb,var(--ink-3)_28%,transparent)]',
  readonly:
    'text-[#7A8A9D] dark:text-[#6A7A95] bg-[color-mix(in_srgb,var(--ink-3)_8%,transparent)] border-[color-mix(in_srgb,var(--ink-3)_22%,transparent)]',
};

/** Dropdown menu row — strong enough to tell roles apart at a glance. */
export const ROLE_DROPDOWN_CARD: Record<string, string> = {
  platform_admin:
    'border-l-[var(--brand-a)] bg-[color-mix(in_srgb,var(--brand-a)_12%,var(--estate-surface))] dark:bg-[color-mix(in_srgb,var(--brand-a)_14%,transparent)]',
  admin:
    'border-l-[#5B9DFF] bg-[color-mix(in_srgb,#5B9DFF_10%,var(--estate-surface))] dark:bg-[#5B9DFF]/[0.1]',
  member:
    'border-l-[#8A9BAD] bg-[color-mix(in_srgb,var(--ink-3)_10%,var(--estate-surface))] dark:bg-[color-mix(in_srgb,var(--ink-3)_12%,transparent)]',
  readonly:
    'border-l-[color-mix(in_srgb,var(--ink-3)_35%,transparent)] bg-[var(--estate-hover)]',
};

/** Second line in dropdown — accent per tier. */
export const ROLE_SUMMARY_ACCENT: Record<string, string> = {
  platform_admin: 'text-[var(--brand-a-ink)] dark:text-[var(--brand-a-ink)]',
  admin: 'text-[#2563EB] dark:text-[#5B9DFF]',
  member: 'text-[#5A6578] dark:text-[var(--ink-3)]',
  readonly: 'text-muted-foreground',
};

/** Left stripe + panel wash for the optional “about this role” block below the field. */
export const ROLE_PANEL_CLASS: Record<string, string> = {
  platform_admin:
    'border-l-[var(--brand-a)] bg-[color-mix(in_srgb,var(--brand-a)_6%,var(--estate-surface))] dark:bg-[color-mix(in_srgb,var(--brand-a)_8%,transparent)]',
  admin:
    'border-l-[#5B9DFF] bg-[color-mix(in_srgb,#5B9DFF_5%,var(--estate-surface))] dark:bg-[#5B9DFF]/[0.06]',
  member:
    'border-l-[color-mix(in_srgb,var(--ink-3)_70%,transparent)] bg-[color-mix(in_srgb,var(--ink-3)_6%,var(--estate-surface))]',
  readonly:
    'border-l-[color-mix(in_srgb,var(--ink-3)_45%,transparent)] bg-[var(--estate-hover)]',
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
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-size-ui',
        ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.readonly,
        className,
      )}
    >
      {text}
    </span>
  );
}
