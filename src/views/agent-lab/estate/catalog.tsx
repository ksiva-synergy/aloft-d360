'use client';

import React, { useState } from 'react';
import EstateCatalogTab from '@/components/estate/EstateCatalogTab';
import { ScannedObjectsTab } from '@/components/estate';
import { useCatalogRefresh } from '@/components/estate/useCatalogRefresh';
import { cn } from '@/lib/utils';

type TabView = 'discovery' | 'scanned';

const VIEWS: { id: TabView; label: string; hint: string }[] = [
  { id: 'discovery', label: 'All objects', hint: 'Every table and view found in your sources. Choose what to scan next.' },
  { id: 'scanned', label: 'Scanned', hint: 'Objects whose columns have been read, and how far each is through the pipeline.' },
];

export default function EstateCatalogPage() {
  const [view, setView] = useState<TabView>('discovery');
  const [showTestSources, setShowTestSources] = useState(false);
  const refreshKey = useCatalogRefresh();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--estate-bg)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--estate-border)] px-6 py-2.5">
        <div
          role="group"
          aria-label="Catalog view"
          className="inline-flex rounded-ctl border border-[var(--estate-btn-border)] bg-[var(--estate-raised)] p-0.5"
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              title={v.hint}
              onClick={() => setView(v.id)}
              className={cn(
                'h-7 rounded-xs px-3 text-ui transition-colors duration-hover ease-out-strong',
                'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                view === v.id
                  ? 'bg-[var(--brand-a)] text-[var(--on-brand)] shadow-xs'
                  : 'text-[var(--estate-text-secondary)] hover:text-[var(--estate-ink)]',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <label className="ml-auto inline-flex cursor-pointer select-none items-center gap-2 text-ui-regular text-[var(--estate-text-secondary)]">
          <input
            type="checkbox"
            checked={showTestSources}
            onChange={(e) => setShowTestSources(e.target.checked)}
            className="size-4 cursor-pointer rounded-xs accent-[var(--brand-a)]"
          />
          Show test sources
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'discovery' ? (
          <EstateCatalogTab refreshKey={refreshKey} showTestSources={showTestSources} />
        ) : (
          <ScannedObjectsTab refreshKey={refreshKey} showTestSources={showTestSources} />
        )}
      </div>
    </div>
  );
}
