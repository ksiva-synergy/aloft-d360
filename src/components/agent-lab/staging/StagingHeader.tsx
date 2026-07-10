'use client';

import { useRouter, usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AppBreadcrumb } from '@/components/app-breadcrumb';
import { cn } from '@/lib/utils';

const ROOT_PATHS = new Set(['/agent-staging', '/agent-lab', '/health']);

export function StagingHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const isRoot = ROOT_PATHS.has(pathname);

  return (
    <div className="shrink-0 h-[42px] flex items-center gap-2 px-4 border-b bg-[var(--header-bg)] border-[var(--header-border)]">
      <button
        onClick={() => router.back()}
        disabled={isRoot}
        aria-label="Go back"
        className={cn(
          'flex items-center justify-center w-6 h-6 rounded-md transition-colors',
          isRoot
            ? 'text-[var(--muted-foreground)] cursor-not-allowed opacity-40'
            : 'text-[var(--text-secondary,#475569)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]',
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </button>

      <AppBreadcrumb />
    </div>
  );
}
