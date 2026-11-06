'use client';

import { Menu } from 'lucide-react';
import { usePathname } from '@/lib/navigation';
import { AppBreadcrumb } from '@/components/app-breadcrumb';
import { noBreadcrumbRoutes } from '@/lib/breadcrumb-config';
import { toggleMobileNav } from '@/components/agent-lab/staging/StagingSidebar';

export function StagingHeader() {
  const pathname = usePathname();
  // Home has no breadcrumb. An empty bar there is just a black strip, so keep the menu button on small screens only.
  const bare = noBreadcrumbRoutes.has(pathname ?? '');
  return (
    <header className={bare
      ? 'flex h-11 shrink-0 items-center bg-transparent px-4 md:hidden'
      : 'flex h-7 shrink-0 items-center gap-1.5 bg-transparent px-4 pt-1.5 md:px-6'}>
      <button
        onClick={toggleMobileNav}
        aria-label="Open menu"
        className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-3)] md:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <AppBreadcrumb compact />
      </div>
    </header>
  );
}
