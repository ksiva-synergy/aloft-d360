'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ScannedFacetTree from './ScannedFacetTree';
import Pagination from './Pagination';

interface ScannedObjectItem {
  id: string;
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  object_kind: string;
  row_count_est: string | null;
  last_t0_at: string | null;
  last_t1_at: string | null;
  last_t2_at: string | null;
  last_t3_at: string | null;
  last_t4_at: string | null;
  has_embedding: boolean;
  lifecycle: string;
  source_id: string;
  source_name: string | null;
}

interface ScannedTierCounts {
  t0: number;
  t1: number;
  t2: number;
  embed: number;
  t3: number;
  t4: number;
}

type TierFilter = 't0' | 't1' | 't2' | 'embed' | 't3' | 't4' | null;

interface ScannedFilterState {
  catalog?: string;
  schema?: string;
  kind?: string;
  q?: string;
  tier: TierFilter;
  page: number;
  pageSize: number;
}

interface ScannedObjectsTabProps {
  sourceFilter?: string;
  refreshKey?: number;
  showTestSources?: boolean;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const dateObj = new Date(iso);
  const diff = Date.now() - dateObj.getTime();
  if (diff < 0 || diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return dateObj.toLocaleDateString();
}

function formatRowCount(v: string | null): string {
  if (!v) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const TIER_COLORS = {
  t0: '#60A5FA',
  t1: '#86EFAC',
  t2: '#C084FC',
  embed: '#818CF8',
  t3: '#F59E0B',
  t4: '#F472B6',
} as const;

const TIER_LABELS: Record<keyof typeof TIER_COLORS, string> = {
  t0: 'T0 Structural — schema, columns, row counts',
  t1: 'T1 Profile — statistical column profiling',
  t2: 'T2 Semantic — AI summaries and PII detection',
  embed: 'Embed — vector embeddings for semantic search',
  t3: 'T3 Connected — usage analysis and cross-object connections',
  t4: 'T4 Modelled — entity + dimension proposals generated',
};

function TierDot({
  tier,
  filled,
  label,
}: {
  tier: keyof typeof TIER_COLORS;
  filled: boolean;
  label: string;
}) {
  return (
    <span
      title={label}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: filled ? TIER_COLORS[tier] : 'rgba(136, 146, 164, 0.25)',
        marginRight: 3,
      }}
    />
  );
}

function TierLegendPill({
  tier,
  count,
  active,
  onClick,
}: {
  tier: keyof typeof TIER_COLORS;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const color = TIER_COLORS[tier];
  const label = TIER_LABELS[tier];
  return (
    <button
      type="button"
      title={`${label}${active ? ' — click to clear filter' : ' — click to filter'}`}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[10px] tracking-wide transition-all duration-150"
      style={{
        color,
        backgroundColor: active ? `${color}28` : `${color}14`,
        border: active ? `1px solid ${color}` : `1px solid ${color}33`,
        outline: 'none',
        cursor: 'pointer',
        boxShadow: active ? `0 0 0 1px ${color}44` : 'none',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: color,
        }}
      />
      <span style={{ color: 'var(--estate-text-secondary)' }}>{tier.toUpperCase()}</span>
      <span style={{ color: 'var(--estate-text-muted)' }}>{count.toLocaleString()}</span>
    </button>
  );
}

export function ScannedObjectsTab({ sourceFilter, refreshKey = 0, showTestSources = false }: ScannedObjectsTabProps) {
  const router = useRouter();
  const [items, setItems] = useState<ScannedObjectItem[]>([]);
  const [total, setTotal] = useState(0);
  const [tierCounts, setTierCounts] = useState<ScannedTierCounts>({ t0: 0, t1: 0, t2: 0, embed: 0, t3: 0, t4: 0 });
  const [loading, setLoading] = useState(true);
  const [searchVal, setSearchVal] = useState('');

  const [filters, setFilters] = useState<ScannedFilterState>({
    catalog: undefined,
    schema: undefined,
    kind: undefined,
    q: undefined,
    tier: null,
    page: 1,
    pageSize: 50,
  });

  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const borderColor = 'var(--estate-border-gold)';
  const thBg = 'var(--estate-th-bg)';
  const surfaceBg = 'var(--estate-surface)';
  const textDim = 'var(--estate-text-dim)';

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      if (filters.q !== (searchVal || undefined)) {
        setFilters(prev => ({ ...prev, q: searchVal || undefined, page: 1 }));
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [searchVal, filters.q]);

  const fetchObjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sourceFilter && sourceFilter !== 'All') params.append('sourceId', sourceFilter);
      if (filters.kind) params.append('kind', filters.kind);
      if (filters.tier) params.append('tier', filters.tier);
      if (filters.catalog) params.append('catalog', filters.catalog);
      if (filters.schema) params.append('schema', filters.schema);
      if (filters.q) params.append('q', filters.q);
      if (!showTestSources) params.append('excludeTestSources', 'true');
      params.append('page', String(filters.page));
      params.append('pageSize', String(filters.pageSize));

      const res = await fetch(`/api/agent-lab/context/objects/scanned?${params}`);
      if (res.ok) {
        const json = await res.json();
        const newItems = json?.data?.items ?? [];
        const newTotal = json?.data?.total ?? 0;
        const newTierCounts = json?.data?.tierCounts ?? { t0: 0, t1: 0, t2: 0, embed: 0, t3: 0, t4: 0 };
        setItems(newItems);
        setTotal(newTotal);
        setTierCounts(newTierCounts);
      } else {
        setItems([]);
        setTotal(0);
        setTierCounts({ t0: 0, t1: 0, t2: 0, embed: 0, t3: 0, t4: 0 });
      }
    } catch (err) {
      console.error('[ScannedObjectsTab] fetch error', err);
      setItems([]);
      setTotal(0);
      setTierCounts({ t0: 0, t1: 0, t2: 0, embed: 0, t3: 0, t4: 0 });
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, filters, refreshKey, showTestSources]);

  useEffect(() => {
    fetchObjects();
  }, [fetchObjects]);

  const handleFacetSelect = useCallback((catalog?: string, schema?: string) => {
    setFilters(prev => ({ ...prev, catalog, schema, page: 1 }));
  }, []);

  const handleFilterChange = useCallback((updates: Partial<ScannedFilterState>) => {
    setFilters(prev => ({ ...prev, ...updates, page: 1 }));
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }));
  }, []);

  const handleTierClick = useCallback((tier: keyof typeof TIER_COLORS) => {
    setFilters(prev => ({
      ...prev,
      tier: prev.tier === tier ? null : tier,
      page: 1,
    }));
  }, []);

  const selectStyle: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '12px',
    letterSpacing: '0.04em',
    backgroundColor: surfaceBg,
    border: `1px solid var(--estate-border)`,
    borderRadius: '6px',
    color: labelColor,
    padding: '0 12px',
    height: '36px',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%234a5765'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    paddingRight: '30px',
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ScannedFacetTree
        selectedCatalog={filters.catalog}
        selectedSchema={filters.schema}
        onSelect={handleFacetSelect}
        total={total}
        refreshKey={refreshKey}
        showTestSources={showTestSources}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Filter / search bar */}
        <div
          className="flex items-center gap-3 px-6 py-3.5 flex-wrap"
          style={{ background: 'var(--estate-bg)' }}
        >
          {/* Search */}
          <div
            className="flex-1 min-w-[220px] flex items-center gap-2 h-9 px-3"
            style={{
              backgroundColor: surfaceBg,
              border: `1px solid var(--estate-border)`,
              borderRadius: '6px',
            }}
            onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--estate-btn-border)'; }}
            onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--estate-border)'; }}
          >
            <span style={{ color: textDim, fontSize: '14px' }}>⌕</span>
            <input
              type="text"
              placeholder={`Search ${total} scanned objects…`}
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none"
              style={{
                color: inkColor,
                fontFamily: "'Inter Tight', sans-serif",
                fontSize: '13px',
              }}
            />
          </div>

          {/* Kind filter */}
          <select
            style={selectStyle}
            value={filters.kind || ''}
            onChange={e => handleFilterChange({ kind: e.target.value || undefined })}
          >
            <option value="">Kind: All</option>
            <option value="table">Table</option>
            <option value="view">View</option>
            <option value="materialized_view">Materialized View</option>
          </select>
        </div>

        {/* Tier coverage strip — pills are clickable filters */}
        <div
          className="flex items-center justify-between gap-4 px-6 py-2 border-b flex-wrap"
          style={{
            background: 'var(--estate-surface)',
            borderColor: 'var(--estate-border)',
          }}
        >
          <span className="font-mono text-[10px] tracking-wide" style={{ color: mutedColor }}>
            {loading && total === 0 ? '—' : `${total.toLocaleString()} scanned object${total !== 1 ? 's' : ''}`}
            {filters.tier && (
              <span style={{ color: TIER_COLORS[filters.tier], marginLeft: 6 }}>
                · {filters.tier.toUpperCase()} filter active
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {(Object.keys(TIER_COLORS) as Array<keyof typeof TIER_COLORS>).map(tier => (
              <TierLegendPill
                key={tier}
                tier={tier}
                count={tierCounts[tier]}
                active={filters.tier === tier}
                onClick={() => handleTierClick(tier)}
              />
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs text-left">
            <thead>
              <tr
                className="sticky top-0 z-10 border-b select-none"
                style={{ backgroundColor: thBg, borderColor }}
              >
                <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Object Path</th>
                <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-28" style={{ color: labelColor }}>Kind</th>
                <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-32" style={{ color: labelColor }}>Source</th>
                <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-20 text-right" style={{ color: labelColor }}>Rows</th>
                <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-36" style={{ color: labelColor }}>Last Scanned</th>
                <th className="p-3 font-mono text-[9px] font-bold tracking-widest uppercase w-24 text-center" style={{ color: labelColor }}>Tiers</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                [...Array(8)].map((_, idx) => (
                  <tr key={idx} className="animate-pulse border-b" style={{ borderColor, backgroundColor: idx % 2 === 0 ? 'var(--estate-row-even)' : 'var(--estate-row-odd)' }}>
                    <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-3/4" /></td>
                    <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-16" /></td>
                    <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-24" /></td>
                    <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-12 ml-auto" /></td>
                    <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-20" /></td>
                    <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-16 mx-auto" /></td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <span className="text-xl opacity-40 font-mono">◆</span>
                      <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: labelColor }}>
                        No Scanned Objects
                      </span>
                      <p className="text-xs max-w-sm text-center" style={{ color: mutedColor }}>
                        {filters.q
                          ? `No objects matching "${filters.q}" found.`
                          : filters.tier
                            ? `No objects at tier "${filters.tier.toUpperCase()}" found. Click the tier pill again to clear the filter.`
                            : filters.kind
                              ? `No objects of kind "${filters.kind}" have been scanned yet.`
                              : 'No objects have been T0-scanned yet. Run a Structural Scan job to discover and register objects from your data sources.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : items.map((obj, idx) => (
                <tr
                  key={obj.id}
                  style={{ backgroundColor: idx % 2 === 0 ? 'var(--estate-row-even)' : 'var(--estate-row-odd)', borderBottom: `1px solid ${borderColor}`, cursor: 'pointer' }}
                  className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors duration-150"
                  onClick={() => router.push(`/agent-lab/estate/object/${obj.id}`)}
                >
                  <td className="p-3 font-mono text-xs max-w-[280px]">
                    <span
                      style={{ color: inkColor }}
                      title={obj.full_path}
                      className="truncate block"
                    >
                      {obj.full_path}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className="px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider"
                      style={{
                        borderColor: 'rgba(96, 165, 250, 0.3)',
                        color: '#60A5FA',
                        backgroundColor: 'var(--estate-kind-bg)',
                      }}
                    >
                      {obj.object_kind}
                    </span>
                  </td>
                  <td className="p-3 text-xs truncate max-w-[120px]" style={{ color: labelColor }}>
                    {obj.source_name ?? '—'}
                  </td>
                  <td className="p-3 text-right font-mono text-xs" style={{ color: mutedColor }}>
                    {formatRowCount(obj.row_count_est)}
                  </td>
                  <td className="p-3 font-mono text-xs" title={obj.last_t0_at ? new Date(obj.last_t0_at).toLocaleString() : '—'} style={{ color: labelColor }}>
                    {relativeTime(obj.last_t0_at)}
                  </td>
                  <td className="p-3 text-center">
                    <TierDot tier="t0" filled={!!obj.last_t0_at} label="T0 Structural" />
                    <TierDot tier="t1" filled={!!obj.last_t1_at} label="T1 Profile" />
                    <TierDot tier="t2" filled={!!obj.last_t2_at} label="T2 Semantic" />
                    <TierDot tier="embed" filled={obj.has_embedding} label="Embed" />
                    <TierDot tier="t3" filled={!!obj.last_t3_at} label="T3 Connected" />
                    <TierDot tier="t4" filled={!!obj.last_t4_at} label="T4 Modelled" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  );
}
