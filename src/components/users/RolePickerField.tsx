'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Info } from 'lucide-react';
import { ROLE_COPY, ROLE_ORDER, roleCopy, type PlatformRoleName } from './role-copy';
import {
  RoleBadge,
  ROLE_DROPDOWN_CARD,
  ROLE_PANEL_CLASS,
  ROLE_SUMMARY_ACCENT,
} from './RoleBadge';

interface RolePickerFieldProps {
  value: string;
  onChange: (role: string) => void;
  options?: string[];
  id?: string;
  disabled?: boolean;
  currentRole?: string;
  /** Extra detail under the field (default off — copy lives in the dropdown). */
  showDetailPanel?: boolean;
  /** `compact` = short trigger + slim menu (invite). `rich` = card menu (change role). */
  layout?: 'compact' | 'rich';
}

const selectItemShellRich = cn(
  'relative p-1.5 items-stretch rounded-none cursor-pointer outline-none',
  'hover:!bg-transparent focus:!bg-transparent data-[highlighted]:!bg-transparent',
  'data-[state=checked]:!bg-transparent',
  'data-[highlighted]:[&_.role-option-card]:ring-2 data-[highlighted]:[&_.role-option-card]:ring-[var(--brand-a)]/35',
  '[&>span:first-child]:left-2 [&>span:first-child]:top-[1.125rem]',
  '[&>span:first-child_svg]:h-3.5 [&>span:first-child_svg]:w-3.5',
  '[&>span:first-child_svg]:text-[var(--brand-a-ink)]',
);

const selectItemShellCompact = cn(
  'relative cursor-pointer rounded-md py-0 pl-7 pr-2 outline-none',
  'focus:bg-[var(--estate-hover)] data-[highlighted]:bg-[var(--estate-hover)]',
  'data-[state=checked]:bg-[color-mix(in_srgb,var(--brand-a)_6%,transparent)]',
  '[&>span:first-child]:left-2 [&>span:first-child]:top-1/2 [&>span:first-child]:-translate-y-1/2',
  '[&>span:first-child_svg]:h-3.5 [&>span:first-child_svg]:w-3.5',
  '[&>span:first-child_svg]:text-[var(--brand-a-ink)]',
);

export function RolePickerField({
  value,
  onChange,
  options = [...ROLE_ORDER],
  id = 'user-role',
  disabled,
  currentRole,
  showDetailPanel = false,
  layout = 'rich',
}: RolePickerFieldProps) {
  const compact = layout === 'compact';
  const selected = roleCopy(value);
  const panelClass = ROLE_PANEL_CLASS[value] ?? ROLE_PANEL_CLASS.readonly;
  const sorted = [...options].sort(
    (a, b) => ROLE_ORDER.indexOf(a as PlatformRoleName) - ROLE_ORDER.indexOf(b as PlatformRoleName),
  );

  return (
    <div className={cn(showDetailPanel ? (compact ? 'space-y-2' : 'space-y-3') : 'space-y-0')}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className={cn(
            compact
              ? 'h-10 gap-2 py-2 pl-3 pr-3'
              : 'h-auto min-h-[3rem] gap-2 py-2.5 pl-3 pr-3',
            'border-[var(--estate-btn-border)] bg-[var(--estate-surface)] shadow-sm',
            'text-[var(--estate-ink)] focus:ring-2 focus:ring-[var(--brand-a)]/40 focus:ring-offset-0',
            '[&>svg]:text-muted-foreground',
          )}
        >
          <SelectValue placeholder="Choose a role">
            {compact ? (
              <span className="flex w-full items-center gap-2 text-left">
                <RoleBadge role={value} size="sm" />
                <span className="text-size-ui font-medium text-[var(--foreground)] truncate">
                  {selected.label}
                </span>
              </span>
            ) : (
              <span className="flex w-full items-center gap-2.5 text-left">
                <RoleBadge role={value} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-size-body font-semibold text-[var(--foreground)] truncate">
                    {selected.label}
                  </span>
                  <span
                    className={cn(
                      'text-size-caption font-medium leading-snug line-clamp-1',
                      ROLE_SUMMARY_ACCENT[value] ?? ROLE_SUMMARY_ACCENT.readonly,
                    )}
                  >
                    {selected.summary}
                  </span>
                </span>
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          className={cn(
            'z-[100] min-w-[var(--radix-select-trigger-width)] w-[var(--radix-select-trigger-width)]',
            compact ? 'max-w-[24rem]' : 'max-w-[26rem]',
            'border-[var(--estate-border)] bg-[var(--estate-surface)] shadow-xl',
            compact ? 'p-1.5' : 'p-0',
            '[&>div:nth-child(2)]:!h-auto [&>div:nth-child(2)]:max-h-[min(16rem,55vh)] [&>div:nth-child(2)]:p-0',
            !compact && '[&>div:nth-child(2)]:p-2 [&>div:nth-child(2)]:max-h-[min(22rem,70vh)]',
          )}
          position="popper"
        >
          {sorted.map((role) => {
            const copy = ROLE_COPY[role as PlatformRoleName] ?? ROLE_COPY.readonly;
            const isCurrent = currentRole === role;
            const isSelected = value === role;
            const cardClass = ROLE_DROPDOWN_CARD[role] ?? ROLE_DROPDOWN_CARD.readonly;
            const summaryAccent = ROLE_SUMMARY_ACCENT[role] ?? ROLE_SUMMARY_ACCENT.readonly;

            if (compact) {
              return (
                <SelectItem
                  key={role}
                  value={role}
                  className={selectItemShellCompact}
                  textValue={copy.label}
                >
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-sm border-l-[3px] py-2 pl-2.5 pr-1',
                      cardClass,
                    )}
                  >
                    <RoleBadge role={role} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-size-ui font-medium text-[var(--foreground)] leading-tight">
                        {copy.label}
                        {isCurrent && (
                          <span className="ml-1.5 text-eyebrow uppercase text-muted-foreground font-normal">
                            · current
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          'block text-size-caption leading-snug line-clamp-1',
                          summaryAccent,
                        )}
                      >
                        {copy.summary}
                      </span>
                    </span>
                  </div>
                </SelectItem>
              );
            }

            return (
              <SelectItem key={role} value={role} className={selectItemShellRich} textValue={copy.label}>
                <div
                  className={cn(
                    'role-option-card ml-5 w-[calc(100%-1.25rem)] rounded-md border border-[var(--estate-border)]',
                    'border-l-[3px] px-2.5 py-2.5 text-left transition-shadow',
                    cardClass,
                    isSelected && 'ring-2 ring-[var(--brand-a)]/45 ring-offset-1 ring-offset-[var(--estate-surface)]',
                  )}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <RoleBadge role={role} size="sm" />
                    {isCurrent && (
                      <span className="rounded border border-[var(--estate-border)] bg-[var(--estate-surface)] px-1.5 py-px text-eyebrow uppercase text-muted-foreground">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-size-body font-semibold leading-tight text-[var(--foreground)]">
                    {copy.label}
                  </p>
                  <p className={cn('mt-1 text-size-ui font-medium leading-snug', summaryAccent)}>
                    {copy.summary}
                  </p>
                  <p className="mt-1.5 text-size-caption leading-relaxed text-muted-foreground whitespace-normal">
                    {copy.detail}
                  </p>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {showDetailPanel && (
        <div
          className={cn(
            'rounded-md border border-[var(--estate-border)] px-3 py-2.5',
            compact ? 'mt-2 bg-[var(--estate-hover)]/60' : cn('border-l-4', panelClass),
          )}
          aria-live="polite"
        >
          {!compact && (
            <div className="mb-1.5 flex items-center gap-1.5 text-eyebrow uppercase text-muted-foreground">
              <Info className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
              About this role
            </div>
          )}
          <p
            className={cn(
              'text-[var(--foreground)]',
              compact ? 'text-size-caption leading-relaxed text-muted-foreground' : 'text-size-body leading-relaxed',
            )}
          >
            {selected.detail}
          </p>
        </div>
      )}
    </div>
  );
}
