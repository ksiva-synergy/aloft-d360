'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FilterState } from './FilterBar';
import KindBadge from './KindBadge';
import StatusChip from './StatusChip';
import FreshnessDot from './FreshnessDot';

interface ObjectTableProps {
  filters: FilterState;
  onTotalChange: (total: number) => void;
}

export default function ObjectTable({ filters, onTotalChange }: ObjectTableProps) {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const onTotalChangeRef = useRef(onTotalChange);
  useEffect(() => {
    onTotalChangeRef.current = onTotalChange;
  });

  // Fetch objects when filters change
  useEffect(() => {
    async function fetchObjects() {
      try {
        setLoading(true);
        const queryParams = new URLSearchParams();
        if (filters.sourceId) queryParams.append('sourceId', filters.sourceId);
        if (filters.catalog) queryParams.append('catalog', filters.catalog);
        if (filters.schema) queryParams.append('schema', filters.schema);
        if (filters.q) queryParams.append('q', filters.q);
        if (filters.status) queryParams.append('status', filters.status);
        if (filters.stale || filters.neverProfiled) queryParams.append('stale', 'true');
        if (filters.hasPii) queryParams.append('hasPii', 'true');
        
        queryParams.append('page', String(filters.page));
        queryParams.append('pageSize', String(filters.pageSize));

        const res = await fetch(`/api/agent-lab/context/objects?${queryParams.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch objects');
        
        const json = await res.json();
        const data = json.data || { items: [], total: 0 };
        
        setItems(data.items || []);
        setTotal(data.total || 0);
        onTotalChangeRef.current(data.total || 0);
      } catch (err) {
        console.error('Error fetching objects:', err);
      } finally {
        setLoading(false);
      }
    }

    void fetchObjects();
  }, [filters]);

  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const borderColor = 'var(--estate-border-gold)';
  const hoverBg = 'var(--estate-hover)';
  const thBg = 'var(--estate-th-bg)';

  // Apply client-side filter for "Never Profiled" if chosen
  const displayedItems = items.filter((item) => {
    if (filters.neverProfiled) {
      return item.last_t1_at === null;
    }
    return true;
  });

  const getTags = (entityTags: any): string[] => {
    if (Array.isArray(entityTags)) return entityTags;
    if (entityTags && typeof entityTags === 'object') {
      if (Array.isArray(entityTags.tags)) return entityTags.tags;
      if (Array.isArray(entityTags.labels)) return entityTags.labels;
    }
    return [];
  };

  const getSummary = (item: any) => {
    if (item.semantic_summary) {
      const summary = item.semantic_summary;
      return summary.length > 120 ? summary.substring(0, 120) + '...' : summary;
    }
    if (item.native_comment) {
      return item.native_comment.length > 120 ? item.native_comment.substring(0, 120) + '...' : item.native_comment;
    }
    return 'No description';
  };

  const getStatus = (item: any) => {
    return item.semantic_status || 'uncatalogued';
  };

  const getStale = (item: any) => {
    return item.last_t1_at === null || new Date(item.last_t1_at) < new Date(item.last_t0_at);
  };

  const hasPiiFlag = (item: any) => {
    const cols = item.pii_columns;
    return Array.isArray(cols) && cols.length > 0;
  };

  return (
    <div className="flex-1 flex flex-col min-height-0 overflow-hidden bg-[var(--background)]">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs transition-colors duration-200">
          <thead>
            <tr
              className="sticky top-0 z-18 border-b"
              style={{
                backgroundColor: thBg,
                borderColor: borderColor,
              }}
            >
              <th
                className="text-left font-mono text-[9px] font-bold tracking-widest uppercase p-3"
                style={{ color: labelColor }}
              >
                Object Path
              </th>
              <th
                className="text-left font-mono text-[9px] font-bold tracking-widest uppercase p-3 w-20"
                style={{ color: labelColor }}
              >
                Kind
              </th>
              <th
                className="text-right font-mono text-[9px] font-bold tracking-widest uppercase p-3 w-24"
                style={{ color: labelColor }}
              >
                Rows
              </th>
              <th
                className="text-right font-mono text-[9px] font-bold tracking-widest uppercase p-3 w-16"
                style={{ color: labelColor }}
              >
                Cols
              </th>
              <th
                className="text-left font-mono text-[9px] font-bold tracking-widest uppercase p-3"
                style={{ color: labelColor }}
              >
                Summary
              </th>
              <th
                className="text-left font-mono text-[9px] font-bold tracking-widest uppercase p-3 w-28"
                style={{ color: labelColor }}
              >
                Status
              </th>
              <th
                className="text-center font-mono text-[9px] font-bold tracking-widest uppercase p-3 w-16"
                style={{ color: labelColor }}
              >
                Fresh
              </th>
              <th
                className="text-center font-mono text-[9px] font-bold tracking-widest uppercase p-3 w-12"
                style={{ color: labelColor }}
              >
                Pii
              </th>
              <th
                className="text-left font-mono text-[9px] font-bold tracking-widest uppercase p-3"
                style={{ color: labelColor }}
              >
                Entity Tags
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // Loading Skeleton rows
              [...Array(8)].map((_, idx) => (
                <tr
                  key={idx}
                  className="animate-pulse border-b"
                  style={{ borderColor: borderColor }}
                >
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-4/5"></div></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-12"></div></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-16 ml-auto"></div></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-8 ml-auto"></div></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/10 rounded w-5/6"></div></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-16"></div></td>
                  <td className="p-3 text-center"><div className="h-2.5 w-2.5 bg-slate-400/20 rounded-full inline-block"></div></td>
                  <td className="p-3 text-center"><div className="h-3 bg-slate-400/20 rounded w-3 inline-block"></div></td>
                  <td className="p-3"><div className="h-4 bg-slate-400/20 rounded w-20"></div></td>
                </tr>
              ))
            ) : displayedItems.length === 0 ? (
              // Empty State
              <tr>
                <td colSpan={9} className="p-12 text-center">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <span className="w-9 h-9 relative block opacity-30">
                      <span className="absolute inset-0 border-2 rotate-45" style={{ borderColor: '#FDB515' }} />
                      <span className="absolute inset-2.5 border-2 rotate-45 opacity-60" style={{ borderColor: '#FDB515' }} />
                    </span>
                    <span className="text-sm font-semibold" style={{ color: inkColor, fontFamily: "'Inter Tight', sans-serif" }}>
                      No objects match your filters
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              // Table rows
              displayedItems.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => router.push(`/agent-lab/estate/object/${item.id}`)}
                  className="border-b transition-colors duration-150 cursor-pointer select-none"
                  style={{ borderColor: borderColor }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = hoverBg;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {/* full_path */}
                  <td
                    className="p-3 font-mono text-[12px] truncate max-w-[200px]"
                    style={{ color: inkColor }}
                    title={item.full_path}
                  >
                    {item.full_path}
                  </td>
                  {/* kind */}
                  <td className="p-3">
                    <KindBadge kind={item.object_kind} />
                  </td>
                  {/* rows */}
                  <td className="p-3 text-right font-mono text-[12px]" style={{ color: inkColor }}>
                    {item.row_count_est !== null ? Number(item.row_count_est).toLocaleString() : '—'}
                  </td>
                  {/* columns (always "—") */}
                  <td className="p-3 text-right font-mono text-[12px]" style={{ color: mutedColor }}>
                    —
                  </td>
                  {/* summary */}
                  <td className="p-3 font-serif text-[12px] truncate max-w-[240px]" style={{ color: labelColor }}>
                    {getSummary(item)}
                  </td>
                  {/* status */}
                  <td className="p-3">
                    <StatusChip status={getStatus(item)} />
                  </td>
                  {/* freshness */}
                  <td className="p-3 text-center">
                    <FreshnessDot stale={getStale(item)} size={7} />
                  </td>
                  {/* pii */}
                  <td className="p-3 text-center">
                    {hasPiiFlag(item) && (
                      <span className="text-red-500 font-bold text-xs" title="PII Detected">
                        ⚑
                      </span>
                    )}
                  </td>
                  {/* entity_tags */}
                  <td className="p-3 text-left">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      {getTags(item.entity_tags).map((tag, idx) => (
                        <span
                          key={idx}
                          className="font-mono text-[9px] font-semibold tracking-wider text-slate-500 border rounded px-1.5 py-0.5"
                          style={{ borderColor: borderColor }}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
