'use client';

import Link from '@/lib/navigation/link';
import { BarChart3 } from 'lucide-react';

export type PowerBiUsageRow = {
  model_id: string;
  model_name: string;
  table_name: string;
};

export function PowerBiObjectUsage({ items }: { items: PowerBiUsageRow[] }) {
  if (!items.length) return null;

  return (
    <div
      className="rounded-card border border-[var(--estate-border)] bg-[var(--estate-raised)] p-4"
      data-testid="powerbi-object-usage"
    >
      <h3 className="flex items-center gap-2 text-ui font-medium text-[var(--estate-ink)]">
        <BarChart3 className="size-4 text-[var(--brand-a)]" aria-hidden />
        Used by {items.length} Power BI model{items.length === 1 ? '' : 's'}
      </h3>
      <ul className="mt-3 space-y-2">
        {items.map((row) => (
          <li key={`${row.model_id}-${row.table_name}`} className="text-ui-regular">
            <Link
              href={`/agent-lab/estate/powerbi?model=${encodeURIComponent(row.model_id)}`}
              className="font-medium text-[var(--brand-a)] hover:underline"
            >
              {row.model_name}
            </Link>
            <span className="text-caption text-[var(--estate-text-muted)]"> · table {row.table_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
