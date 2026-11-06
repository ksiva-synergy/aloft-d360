'use client';

import React from 'react';
import { Eye, Lock } from 'lucide-react';
import { usePathname } from '@/lib/navigation';
import { sectionForPath, SECTION_GROUP_LABEL } from '@/lib/sections/registry';
import { useSectionLevels } from '@/lib/sections/useSectionLevels';

/**
 * Page gate for enforced sections (src/lib/sections):
 *   none   → an explanation instead of the page
 *   view   → the page with a view-only notice (skipped on view-only sections such as the Audit log)
 *   manage → the page as-is
 * Sections that are not enforced yet render as before. Presentation only: the APIs check the same rules.
 */
export default function SectionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useSectionLevels();
  const section = sectionForPath(pathname);

  if (!section?.enforced) return <>{children}</>;
  if (me === null) {
    return (
      <p role="status" className="p-6 text-ui-regular text-muted-foreground">
        Loading…
      </p>
    );
  }

  const level = me.levels[section.id] ?? 'none';
  if (level === 'none') {
    return (
      <div className="mx-auto mt-16 max-w-md px-6 text-center">
        <Lock aria-hidden className="mx-auto size-6 text-muted-foreground" />
        <h2 className="mt-3 text-title-section">No access to {section.label}</h2>
        <p className="mt-1 text-ui-regular text-muted-foreground">
          {SECTION_GROUP_LABEL[section.group]} → {section.label} is not part of your access. Ask a platform admin to add
          you to a bundle that includes it.
        </p>
      </div>
    );
  }

  // Full access (or nothing to manage): the page renders exactly as before.
  if (level === 'manage' || section.viewOnly) return <>{children}</>;

  return (
    <div className="flex h-full flex-col">
      <div
        role="note"
        className="flex shrink-0 items-center gap-2 border-b border-[var(--header-border)] bg-[var(--surface-2,var(--muted))] px-4 py-1.5 text-caption text-muted-foreground md:px-6"
      >
        <Eye aria-hidden className="size-3.5 shrink-0" />
        View only. You can look around {section.label}, but changes will be refused.
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
