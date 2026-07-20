'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface TabItem {
  label: string;
  href: string;
  matchType: 'exact' | 'prefix';
}

const TABS: TabItem[] = [
  { label: 'Overview', href: '/agent-lab/estate', matchType: 'exact' },
  { label: 'Catalog', href: '/agent-lab/estate/catalog', matchType: 'prefix' },
  { label: 'Entities', href: '/agent-lab/estate/entities', matchType: 'prefix' },
  { label: 'Lineage', href: '/agent-lab/estate/lineage', matchType: 'prefix' },
  { label: 'Jobs', href: '/agent-lab/estate/jobs', matchType: 'exact' },
  { label: 'Mapper', href: '/agent-lab/estate/mapper', matchType: 'exact' },
  { label: 'Silo Finder', href: '/agent-lab/estate/silo', matchType: 'exact' },
];

export default function EstateNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between px-6 border-b shrink-0 bg-[var(--background)] border-[var(--nav-border)]">
      <div className="flex items-center gap-1 h-12">
        {TABS.map((tab) => {
          const isActive =
            tab.matchType === 'exact'
              ? pathname === tab.href
              : pathname === tab.href || pathname.startsWith(tab.href + '/');

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
