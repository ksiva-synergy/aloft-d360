'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ESTATE_NAV_ITEMS, isEstateItemActive } from '@/lib/estate/nav-items';

export default function EstateNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between px-6 border-b shrink-0 bg-[var(--background)] border-[var(--nav-border)]">
      <div className="flex items-center gap-1 h-12">
        {ESTATE_NAV_ITEMS.map((tab) => {
          const isActive = isEstateItemActive(tab, pathname);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative flex items-center h-full px-4 text-xs font-mono tracking-wider uppercase font-semibold transition-colors duration-200 rounded-t',
                isActive
                  ? 'text-[var(--nav-item-text-active)] bg-black/[0.04] dark:bg-[rgba(253,181,21,0.1)]'
                  : 'text-[var(--nav-item-text)] bg-transparent hover:text-[var(--nav-text)]',
              )}
            >
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t bg-[#FDB515]" />
              )}
            </Link>
          );
        })}
      </div>
      <div className="text-[11px] font-mono tracking-wider text-right uppercase text-[var(--nav-item-text)]">
        Data Estate System
      </div>
    </div>
  );
}
