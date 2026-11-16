'use client';

import React from 'react';
import Link from '@/lib/navigation/link';
import { usePathname } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { ESTATE_NAV_ITEMS, isEstateItemActive } from '@/lib/estate/nav-items';
import { hiddenInNav, type SectionLevels } from '@/lib/sections/registry';

/**
 * Section tabs for Data Estate. Page context (Data Estate / Power BI / …) lives in the
 * shell breadcrumb — not duplicated as a large title here.
 */
export default function EstateNav({ levels = null }: { levels?: SectionLevels | null }) {
  const pathname = usePathname();
  const tabs = ESTATE_NAV_ITEMS.filter((tab) => !hiddenInNav(levels, tab.href));
  const active =
    ESTATE_NAV_ITEMS.find((tab) => isEstateItemActive(tab, pathname)) ??
    (pathname.startsWith('/agent-lab/estate/object/')
      ? ESTATE_NAV_ITEMS.find((tab) => tab.href === '/agent-lab/estate/catalog')
      : undefined);
  const showBack =
    active && pathname !== active.href && pathname.startsWith(active.href + '/');

  return (
    <header className="shrink-0 border-b border-[var(--estate-border)] bg-[var(--estate-surface)] px-4 py-1.5 md:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {showBack && active && (
          <Link
            href={active.href}
            className="shrink-0 text-caption text-[var(--estate-text-secondary)] underline-offset-2 hover:text-[var(--estate-ink)] hover:underline"
          >
            ← {active.label}
          </Link>
        )}
        <nav
          aria-label="Data estate sections"
          className={cn(
            'min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]',
            showBack && 'max-w-full',
          )}
        >
          <div className="flex w-max min-h-9 items-center gap-1">
            {tabs.map((tab) => {
              const isActive = tab === active;
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={isActive ? 'page' : undefined}
                  title={tab.description}
                  className={cn(
                    'group relative flex h-9 items-center gap-1.5 whitespace-nowrap px-2.5 text-caption sm:px-3 sm:text-ui',
                    'transition-colors duration-hover ease-out-strong',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] rounded-t-ctl',
                    isActive
                      ? 'text-[var(--estate-ink)]'
                      : 'text-[var(--estate-text-muted)] hover:text-[var(--estate-ink)]',
                  )}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-ctl px-1.5 py-0.5 transition-colors duration-hover sm:px-2 sm:py-1',
                      !isActive && 'group-hover:bg-[var(--estate-hover)]',
                    )}
                  >
                    {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
                    {tab.label}
                  </span>
                  {isActive && (
                    <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--brand-a)]" />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </header>
  );
}