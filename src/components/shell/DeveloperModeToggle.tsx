'use client';

import { Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDeveloperMode } from '@/hooks/useDeveloperMode';

/** Admin-only: reveal describe_schema steps, SQL inspect panels, and Developer tabs. */
export function DeveloperModeToggle({
  className,
  compact = false,
}: {
  className?: string;
  /** Single-line row for dense menus (subtitle → tooltip). */
  compact?: boolean;
}) {
  const { canToggle, enabled, setDeveloperMode, hydrated } = useDeveloperMode();
  if (!canToggle || !hydrated) return null;

  return (
    <label
      title={compact ? 'Tool steps, SQL, and inspect panels' : undefined}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2 rounded-lg text-size-ui text-[var(--ink-2)] hover:bg-[var(--surface-2)]',
        compact ? 'px-1 py-1' : 'gap-3 px-2 py-2',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Code2 className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" aria-hidden />
        <span>
          <span className="block font-medium text-[var(--ink-1)]">Developer mode</span>
          {!compact && (
            <span className="block text-[length:var(--type-caption-size)] leading-snug text-[var(--ink-3)]">
              Tool steps, SQL, and inspect panels
            </span>
          )}
        </span>
      </span>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setDeveloperMode(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--brand-a)]"
        aria-label="Developer mode"
      />
    </label>
  );
}
