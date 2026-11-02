'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { useRouter } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { EstateFilterState } from './EstateFilterBar';
import LifecycleBadge, { computeLifecycle, type LifecycleState } from './LifecycleBadge';
import { CATALOG_BTN, CATALOG_BTN_PRIMARY, ObjectNameCell, formatCompactCount, formatFull, formatRelative } from './catalog-ui';

interface EstateTableProps {
  filters: EstateFilterState;
  onTotalChange: (total: number) => void;
  selectedPaths: Set<string>;
  onSelectionChange: (paths: Set<string>) => void;
  onPreviewColumns: (path: string, contextObjectId?: string | null) => void;
  onHarvest: (paths: string[]) => void;
  onSyncKnowledge: (paths: string[]) => void;
  onScheduleChange?: (action: 'include' | 'exclude', scope: { paths?: string[]; schemas?: string[]; catalogs?: string[] }) => void;
  drawerOpen?: boolean;
  refreshKey?: number;
  showTestSources?: boolean;
  canRunPipeline?: boolean;
}

const TH = 'sticky top-0 z-10 border-b border-[var(--estate-border)] bg-[var(--estate-bg)] px-3 py-2.5 text-left text-caption font-medium uppercase tracking-wide text-[var(--estate-text-muted)] whitespace-nowrap';
const TD = 'border-b border-[var(--estate-border)] px-3 py-2.5';
const SKELETON = 'h-3.5 animate-pulse rounded bg-[color:color-mix(in_srgb,var(--line-2)_15%,transparent)]';

export default function EstateTable({
  filters,
  onTotalChange,
  selectedPaths,
  onSelectionChange,
  onPreviewColumns,
  onHarvest,
  onSyncKnowledge,
  onScheduleChange,
  drawerOpen = false,
  refreshKey = 0,
  showTestSources = false,
  canRunPipeline = false,
}: EstateTableProps) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const onTotalChangeRef = useRef(onTotalChange);
  useEffect(() => { onTotalChangeRef.current = onTotalChange; });

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (filters.catalog) params.append('catalog', filters.catalog);
        if (filters.schema) params.append('schema', filters.schema);
        if (filters.kind) params.append('kind', filters.kind);
        if (filters.lifecycle) params.append('harvest', filters.lifecycle);
        if (filters.q) params.append('q', filters.q);
        if (!showTestSources) params.append('excludeTestSources', 'true');
        if (filters.sourceId) params.append('sourceId', filters.sourceId);
        params.append('page', String(filters.page));
        params.append('pageSize', String(filters.pageSize));

        const res = await fetch(`/api/agent-lab/context/estate?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch');

        const data = await res.json();
        setItems(data.rows ?? []);
        onTotalChangeRef.current(data.total ?? 0);
      } catch (err) {
        console.error('[EstateTable]', err);
        setItems([]);
        onTotalChangeRef.current(0);
      } finally {
        setLoading(false);
      }
    }
    void fetchData();
  }, [filters, refreshKey, showTestSources]);

  const router = useRouter();

  const handleRowClick = (item: any, lc: string) => {
    if (lc !== 'discovered' && item.context_object_id) {
      router.push(`/agent-lab/estate/object/${item.context_object_id}`);
    } else {
      onPreviewColumns(item.full_path, item.context_object_id);
    }
  };

  const allSelected = items.length > 0 && items.every(i => selectedPaths.has(i.full_path));
  const someSelected = !allSelected && items.some(i => selectedPaths.has(i.full_path));

  const toggleAll = () => {
    if (allSelected) onSelectionChange(new Set());
    else onSelectionChange(new Set(items.map(i => i.full_path)));
  };

  const toggleOne = (path: string) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onSelectionChange(next);
  };

  /** The one action that moves this row forward. Non-actionable states rely on the Stage badge. */
  const rowAction = (item: any, lc: LifecycleState) => {
    if (!canRunPipeline) return null;
    const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
    switch (lc) {
      case 'discovered':
        return (
          <button type="button" className={CATALOG_BTN} title="Add to the next scheduled scan"
            onClick={stop(() => onScheduleChange?.('include', { paths: [item.full_path] }))}>
            Add to scan
          </button>
        );
      case 'scheduled':
        return (
          <button type="button" className={cn(CATALOG_BTN, 'hover:border-[var(--bad)] hover:text-[var(--bad)]')} title="Take out of the scheduled scan"
            onClick={stop(() => onScheduleChange?.('exclude', { paths: [item.full_path] }))}>
            Remove from scan
          </button>
        );
      case 'analyzed':
      case 'enriched':
        return (
          <button type="button" className={CATALOG_BTN} title="Run the structural scan (T0) again"
            onClick={stop(() => onHarvest([item.full_path]))}>
            Rescan
          </button>
        );
      case 'embedded':
      case 'stale':
        return (
          <button type="button" className={cn(CATALOG_BTN_PRIMARY, 'h-7 px-2.5')} title="Publish to the knowledge base"
            onClick={stop(() => onSyncKnowledge([item.full_path]))}>
            {lc === 'stale' ? 'Republish' : 'Publish'}
          </button>
        );
      default:
        return null;
    }
  };

  const checkbox = (checked: boolean, onToggle: () => void, label: string, mixed = false) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={el => { if (el) el.indeterminate = mixed; }}
      onChange={onToggle}
      onClick={e => e.stopPropagation()}
      className="size-3.5 cursor-pointer align-middle accent-[var(--brand-a)]"
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex-1 overflow-auto px-6"
        style={{ paddingRight: drawerOpen ? 484 : undefined, transition: 'padding-right 0.22s cubic-bezier(0.4, 0, 0.2, 1)' }}
      >
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-36" />
            <col className="w-20" />
            <col className="w-28" />
            <col className="w-44" />
          </colgroup>
          <thead>
            <tr>
              <th className={cn(TH, 'pl-3.5')}>{checkbox(allSelected, toggleAll, 'Select all on this page', someSelected)}</th>
              <th className={TH}>Object</th>
              <th className={TH}>Stage</th>
              <th className={cn(TH, 'text-right')}>Rows</th>
              <th className={TH}>Last seen</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(12)].map((_, idx) => (
                <tr key={idx}>
                  <td className={cn(TD, 'pl-3.5')}><div className={cn(SKELETON, 'w-3.5')} /></td>
                  <td className={TD}><div className={cn(SKELETON, 'w-3/5')} /></td>
                  <td className={TD}><div className={cn(SKELETON, 'w-20')} /></td>
                  <td className={TD}><div className={cn(SKELETON, 'ml-auto w-10')} /></td>
                  <td className={TD}><div className={cn(SKELETON, 'w-14')} /></td>
                  <td className={TD} />
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <p className="text-ui text-[var(--estate-text-secondary)]">No objects match your filters</p>
                  <p className="mt-1 text-caption text-[var(--estate-text-muted)]">Try another catalog, clear the search or change the stage filter.</p>
                </td>
              </tr>
            ) : (
              items.map(item => {
                const isSelected = selectedPaths.has(item.full_path);
                const rows = formatCompactCount(item.row_count_est);
                const lc = computeLifecycle(item.live_harvest_state, item.last_t2_at, item.last_knowledge_sync_at, item.last_t0_at, item.last_t1_at, item.last_t3_at, item.has_embedding, item.last_t4_at);
                const opensDetail = lc !== 'discovered' && !!item.context_object_id;

                return (
                  <tr
                    key={item.id}
                    onClick={() => handleRowClick(item, lc)}
                    className={cn(
                      'group cursor-pointer transition-colors duration-100 hover:bg-[var(--estate-hover)]',
                      isSelected && 'bg-[color:color-mix(in_srgb,var(--brand-a)_6%,transparent)]',
                    )}
                    title={opensDetail ? 'Open object' : 'Preview columns'}
                  >
                    <td className={cn(TD, 'pl-3.5')} onClick={e => e.stopPropagation()}>
                      {checkbox(isSelected, () => toggleOne(item.full_path), `Select ${item.full_path}`)}
                    </td>
                    <td className={TD}>
                      <ObjectNameCell path={item.full_path} kind={item.object_type} />
                    </td>
                    <td className={TD}>
                      <LifecycleBadge
                        harvestState={item.live_harvest_state}
                        lastT0At={item.last_t0_at}
                        lastT1At={item.last_t1_at}
                        lastT2At={item.last_t2_at}
                        lastT3At={item.last_t3_at}
                        lastT4At={item.last_t4_at}
                        hasEmbedding={item.has_embedding}
                        lastKnowledgeSyncAt={item.last_knowledge_sync_at}
                      />
                    </td>
                    <td
                      className={cn(TD, 'text-right font-mono text-ui-regular tabular-nums', rows ? 'text-[var(--estate-text-secondary)]' : 'text-[var(--estate-text-dim)]')}
                      title={item.row_count_est != null ? `${Number(item.row_count_est).toLocaleString()} rows (estimate)` : undefined}
                    >
                      {rows ?? '\u2014'}
                    </td>
                    <td className={cn(TD, 'text-ui-regular text-[var(--estate-text-muted)]')} title={formatFull(item.last_inventoried_at)}>
                      {formatRelative(item.last_inventoried_at)}
                    </td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-2">
                        {rowAction(item, lc)}
                        <ChevronRight
                          aria-hidden
                          className="size-4 shrink-0 text-[var(--estate-text-dim)] transition-transform duration-hover group-hover:translate-x-0.5 group-hover:text-[var(--estate-ink)]"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}