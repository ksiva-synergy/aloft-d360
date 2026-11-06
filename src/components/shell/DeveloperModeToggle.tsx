'use client';

import { Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDeveloperMode } from '@/hooks/useDeveloperMode';

/** Admin-only: reveal describe_schema steps, SQL inspect panels, and Developer tabs. */
export function DeveloperModeToggle({ className }: { className?: string }) {
  const { canToggle, enabled, setDeveloperMode, hydrated } = useDeveloperMode();
  if (!canToggle || !hydrated) return null;

  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-size-ui text-[var(--ink-2)] hover:bg-[var(--surface-2)]',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Code2 className="h-4 w-4 shrink-0 text-[var(--ink-3)]" aria-hidden />
        <span>
          <span className="block font-medium text-[var(--ink-1)]">Developer mode</span>
          <span className="block text-[length:var(--type-caption-size)] leading-snug text-[var(--ink-3)]">
            Tool steps, SQL, and inspect panels
          </span>
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
