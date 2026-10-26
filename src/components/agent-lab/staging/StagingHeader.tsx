'use client';

import { useRouter, usePathname } from '@/lib/navigation';
import { ArrowLeft, Menu } from 'lucide-react';
import { AppBreadcrumb } from '@/components/app-breadcrumb';
import { toggleMobileNav } from '@/components/agent-lab/staging/StagingSidebar';
import { cn } from '@/lib/utils';

const ROOT_PATHS = new Set(['/agent-staging', '/agent-lab', '/health', '/dashboard']);

export function StagingHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const isRoot = ROOT_PATHS.has(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-[var(--shell-header-h)] shrink-0 items-center gap-2 border-b border-[var(--header-border)] bg-[var(--header-bg)] px-4 backdrop-blur-md md:px-6">
      <button
        onClick={toggleMobileNav}
        aria-label="Open menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-3)] md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <button
        onClick={() => router.back()}
        disabled={isRoot}
        aria-label="Go back"
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
          isRoot
            ? 'cursor-not-allowed text-[var(--ink-3)] opacity-40'
            : 'text-[var(--ink-2)] hover:bg-[var(--surface-3)] hover:text-[var(--ink-1)]',
        )}
      >
        <ArrowLeft className="h-[18px] w-[18px]" />
      </button>

      <span aria-hidden className="mx-1 h-5 w-px bg-[var(--line-1)]" />

      <div className="min-w-0 flex-1 text-[length:var(--type-body-size)]">
        <AppBreadcrumb />
      </div>
    </header>
  );
}
