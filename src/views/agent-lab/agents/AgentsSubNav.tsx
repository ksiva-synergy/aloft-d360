'use client';

import Link from '@/lib/navigation/link';
import { usePathname } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import {
  AGENTS_LIST_HREF,
  AGENTS_WORKBENCH_HREF,
  isAgentsWorkbenchPath,
} from '@/lib/navigation/agents-routes';

const TABS = [
  { label: 'Saved agents', href: AGENTS_LIST_HREF },
  { label: 'Workbench', href: AGENTS_WORKBENCH_HREF },
] as const;

function isTabActive(href: string, pathname: string): boolean {
  if (href === AGENTS_WORKBENCH_HREF) return isAgentsWorkbenchPath(pathname);
  if (pathname === AGENTS_LIST_HREF) return true;
  if (pathname.startsWith(`${AGENTS_LIST_HREF}/`) && !isAgentsWorkbenchPath(pathname)) return true;
  return false;
}

export default function AgentsSubNav() {
  const pathname = usePathname();

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-[var(--line-1)] bg-[var(--surface-1)] px-6"
      role="tablist"
      aria-label="Agents"
    >
      {TABS.map((tab) => {
        const active = isTabActive(tab.href, pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={cn(
              'relative px-4 py-3 text-size-body font-medium transition-colors',
              active ? 'text-[var(--ink-1)]' : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]',
            )}
          >
            {tab.label}
            {active && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--brand-a)]" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
