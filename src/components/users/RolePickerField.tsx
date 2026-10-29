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
}

const selectItemShell = cn(
  'relative p-1.5 items-stretch rounded-none cursor-pointer outline-none',
  'hover:!bg-transparent focus:!bg-transparent data-[highlighted]:!bg-transparent',
  'data-[state=checked]:!bg-transparent',
  'data-[highlighted]:[&_.role-option-card]:ring-2 data-[highlighted]:[&_.role-option-card]:ring-[var(--brand-a)]/35',
  '[&>span:first-child]:left-2 [&>span:first-child]:top-[1.125rem]',
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
}: RolePickerFieldProps) {
  const selected = roleCopy(value);
  const panelClass = ROLE_PANEL_CLASS[value] ?? ROLE_PANEL_CLASS.readonly;
  const sorted = [...options].sort(
    (a, b) => ROLE_ORDER.indexOf(a as PlatformRoleName) - ROLE_ORDER.indexOf(b as PlatformRoleName),
  );

  return (
    <div className={cn(showDetailPanel ? 'space-y-3' : 'space-y-0')}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className={cn(
            'h-auto min-h-[3rem] gap-2 py-2.5 pl-3 pr-3',
            'border-[var(--estate-btn-border)] bg-[var(--estate-surface)] shadow-sm',
            'text-[var(--estate-ink)] focus:ring-2 focus:ring-[var(--brand-a)]/40 focus:ring-offset-0',
            '[&>svg]:text-muted-foreground',
          )}
        >
          <SelectValue placeholder="Choose a role">
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
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          className={cn(
            'z-[100] min-w-[var(--radix-select-trigger-width)] w-[var(--radix-select-trigger-width)] max-w-[26rem]',
            'border-[var(--estate-border)] bg-[var(--estate-surface)] p-0 shadow-xl',
            /* Popper viewport is forced to trigger height in the shared Select — unlock it */
            '[&>div:nth-child(2)]:!h-auto [&>div:nth-child(2)]:max-h-[min(22rem,70vh)] [&>div:nth-child(2)]:p-2',
          )}
          position="popper"
        >
          {sorted.map((role) => {
            const copy = ROLE_COPY[role as PlatformRoleName] ?? ROLE_COPY.readonly;
            const isCurrent = currentRole === role;
            const isSelected = value === role;
            const cardClass = ROLE_DROPDOWN_CARD[role] ?? ROLE_DROPDOWN_CARD.readonly;
            const summaryAccent = ROLE_SUMMARY_ACCENT[role] ?? ROLE_SUMMARY_ACCENT.readonly;

            return (
              <SelectItem key={role} value={role} className={selectItemShell} textValue={copy.label}>
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
            'rounded-md border border-[var(--estate-border)] border-l-4 px-3 py-3',
            panelClass,
          )}
          aria-live="polite"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-eyebrow uppercase text-muted-foreground">
            <Info className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
            About this role
          </div>
          <p className="text-size-body leading-relaxed text-[var(--foreground)]">{selected.detail}</p>
        </div>
      )}
    </div>
  );
}
