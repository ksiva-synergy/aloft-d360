'use client';

import React from 'react';
import Link from '@/lib/navigation/link';
import { usePathname } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { ESTATE_NAV_ITEMS, isEstateItemActive } from '@/lib/estate/nav-items';
import { hiddenInNav, type SectionLevels } from '@/lib/sections/registry';

/**
 * Shared header for every Data Estate page: page title + one-line purpose, then
 * the section tabs. Pages render content only, so the estate reads as one product.
 */
export default function EstateNav({ levels = null }: { levels?: SectionLevels | null }) {
  const pathname = usePathname();
  const tabs = ESTATE_NAV_ITEMS.filter((tab) => !hiddenInNav(levels, tab.href));
  // Object detail pages belong to the catalog.
  const active =
    ESTATE_NAV_ITEMS.find((tab) => isEstateItemActive(tab, pathname)) ??
    (pathname.startsWith('/agent-lab/estate/object/')
      ? ESTATE_NAV_ITEMS.find((tab) => tab.href === '/agent-lab/estate/catalog')
      : undefined);
  // Detail pages (job run, object) render their own h1; keep the header to tabs only.
  const isDetail = !active || pathname !== active.href;
  const title = active ? active.title ?? active.label : 'Data Estate';

  return (
    <header className={cn('shrink-0 border-b border-[var(--header-border)] bg-[var(--header-bg)] px-4 md:px-6', isDetail ? 'pt-1' : 'pt-4')}>
      {!isDetail && (
        <div className="min-w-0">
          {active.href !== '/agent-lab/estate' && (
            <p className="text-eyebrow uppercase text-[var(--nav-item-text)]">Data Estate</p>
          )}
          <h1 className="text-title-section text-[var(--estate-ink,var(--foreground))]">{title}</h1>
          {active.description && (
            <p className="mt-0.5 max-w-3xl text-ui-regular text-[var(--estate-text-secondary,var(--muted-foreground))]">
              {active.description}
            </p>
          )}
        </div>
      )}

      <nav aria-label="Data estate sections" className={cn('-mx-1 overflow-x-auto px-1 [scrollbar-width:none]', !isDetail && 'mt-3')}>
        <div className="flex w-max items-center gap-1">
          {tabs.map((tab) => {
            const isActive = tab === active;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex h-10 items-center gap-1.5 whitespace-nowrap px-3 text-ui',
                  'transition-colors duration-hover ease-out-strong',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] rounded-t-ctl',
                  isActive
                    ? 'text-[var(--brand-a-ink,var(--brand-a))]'
                    : 'text-[var(--nav-item-text)] hover:text-[var(--nav-text)]',
                )}
              >
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-ctl px-2 py-1 transition-colors duration-hover',
                    !isActive && 'group-hover:bg-[color-mix(in_srgb,var(--nav-text)_6%,transparent)]',
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
    </header>
  );
}
