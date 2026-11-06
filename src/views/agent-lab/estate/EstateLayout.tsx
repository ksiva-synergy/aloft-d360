'use client';

import React from 'react';
import { Eye, Lock } from 'lucide-react';
import { usePathname } from '@/lib/navigation';
import { sectionForPath } from '@/lib/sections/registry';
import { useSectionLevels } from '@/lib/sections/useSectionLevels';
import EstateNav from './EstateNav';

/**
 * Data Estate shell. Section access (src/lib/sections):
 *   none   → an explanation instead of the page
 *   view   → the page, with a view-only notice; action buttons are hidden by each page
 *   manage → the page as-is (platform admins only)
 * The APIs check the same rules, so this is presentation only.
 */
export default function EstateLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useSectionLevels();
  const section = sectionForPath(pathname);
  const level = me && section ? (me.levels[section.id] ?? 'none') : null;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--background)]">
      <EstateNav levels={me?.levels ?? null} />
      {level === 'view' ? (
        <div
          role="note"
          className="flex shrink-0 items-center gap-2 border-b border-[var(--header-border)] bg-[var(--surface-2,var(--muted))] px-4 py-1.5 text-caption text-[var(--estate-text-secondary,var(--muted-foreground))] md:px-6"
        >
          <Eye aria-hidden className="size-3.5 shrink-0" />
          View only. Only platform admins can run jobs or change anything in the Data Estate.
        </div>
      ) : null}
      <div className="flex-1 overflow-hidden">
        {me === null ? (
          <p role="status" className="p-6 text-ui-regular text-[var(--estate-text-secondary,var(--muted-foreground))]">
            Loading…
          </p>
        ) : level === 'none' ? (
          <div className="mx-auto mt-16 max-w-md px-6 text-center">
            <Lock aria-hidden className="mx-auto size-6 text-[var(--estate-text-secondary,var(--muted-foreground))]" />
            <h2 className="mt-3 text-title-section">No access to {section?.label ?? 'this page'}</h2>
            <p className="mt-1 text-ui-regular text-[var(--estate-text-secondary,var(--muted-foreground))]">
              The Data Estate is open to admins (view only) and platform admins. Ask a platform admin if you need it.
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
