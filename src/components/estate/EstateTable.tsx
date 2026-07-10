'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { EstateFilterState } from './EstateFilterBar';
import LifecycleBadge, { computeLifecycle } from './LifecycleBadge';

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
}

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

  const borderColor = 'var(--estate-border)';
  const inkColor = 'var(--estate-ink)';
  const textSecondary = 'var(--estate-text-secondary)';
  const textMuted = 'var(--estate-text-muted)';
  const textDim = 'var(--estate-text-dim)';
  const hoverBg = 'var(--estate-hover)';
  const btnBorder = 'var(--estate-btn-border)';
  const estateBg = 'var(--estate-bg)';
  const goldColor = '#FDB515';
  const goldDim = '#9a7a2a';

  const allSelected = items.length > 0 && items.every(i => selectedPaths.has(i.full_path));

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(items.map(i => i.full_path)));
    }
  };

  const toggleOne = (path: string) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onSelectionChange(next);
  };

  const formatRows = (v: string | number | null) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    if (isNaN(n)) return null;
    return n.toLocaleString();
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    const date = new Date(d);
    return date.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const RowAction = ({ item }: { item: any }) => {
    const lc = computeLifecycle(item.live_harvest_state, item.last_t2_at, item.last_knowledge_sync_at, item.last_t0_at, item.last_t1_at, item.last_t3_at, item.has_embedding, item.last_t4_at);

    switch (lc) {
      case 'inaccessible':
        return (
          <span
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px dashed rgba(248, 113, 113, 0.35)`, color: '#f87171', borderRadius: '6px', opacity: 0.6, whiteSpace: 'nowrap' }}
          >
            🔒 Locked
          </span>
        );
      case 'discovered':
        return (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onScheduleChange?.('include', { paths: [item.full_path] }); }}
            className="miniact"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid ${btnBorder}`, color: textMuted, borderRadius: '6px', cursor: 'pointer', background: 'transparent', whiteSpace: 'nowrap' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#60a5fa'; e.currentTarget.style.color = '#60a5fa'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = btnBorder; e.currentTarget.style.color = textMuted; }}
          >
            + Schedule
          </button>
        );
      case 'scheduled':
        return (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onScheduleChange?.('exclude', { paths: [item.full_path] }); }}
            className="miniact"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid rgba(96, 165, 250, 0.4)`, color: '#60a5fa', borderRadius: '6px', cursor: 'pointer', background: 'transparent', whiteSpace: 'nowrap' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#f87171'; e.currentTarget.style.color = '#f87171'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.4)'; e.currentTarget.style.color = '#60a5fa'; }}
          >
            − Unschedule
          </button>
        );
      case 'queued':
        return (
          <span
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid ${btnBorder}`, color: textDim, borderRadius: '6px', opacity: 0.5, whiteSpace: 'nowrap' }}
          >
            In queue
          </span>
        );
      case 'analyzed':
        return (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onHarvest([item.full_path]); }}
            className="miniact"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid rgba(52, 211, 153, 0.35)`, color: '#34d399', borderRadius: '6px', cursor: 'pointer', background: 'transparent', whiteSpace: 'nowrap' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#34d399'; e.currentTarget.style.backgroundColor = 'rgba(52,211,153,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(52, 211, 153, 0.35)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            ↻ Re-harvest
          </button>
        );
      case 'enriched':
        return (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onHarvest([item.full_path]); }}
            className="miniact"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid rgba(167, 139, 250, 0.35)`, color: '#a78bfa', borderRadius: '6px', cursor: 'pointer', background: 'transparent', whiteSpace: 'nowrap' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#a78bfa'; e.currentTarget.style.backgroundColor = 'rgba(167,139,250,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(167, 139, 250, 0.35)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            ↻ Re-harvest
          </button>
        );
      case 'embedded':
        return (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSyncKnowledge([item.full_path]); }}
            className="miniact-gold"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid ${goldDim}`, color: goldColor, borderRadius: '6px', cursor: 'pointer', background: 'transparent', whiteSpace: 'nowrap' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = goldColor; e.currentTarget.style.color = estateBg; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = goldColor; }}
          >
            ↑ Sync to Knowledge
          </button>
        );
      case 'connected':
        return (
          <span
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid rgba(245,158,11,0.3)`, color: '#F59E0B', borderRadius: '6px', opacity: 0.8, whiteSpace: 'nowrap' }}
          >
            ✓ Connected
          </span>
        );
      case 'stale':
        return (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSyncKnowledge([item.full_path]); }}
            className="miniact-gold"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid ${goldDim}`, color: goldColor, borderRadius: '6px', cursor: 'pointer', background: 'transparent', whiteSpace: 'nowrap' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = goldColor; e.currentTarget.style.color = estateBg; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = goldColor; }}
          >
            ↻ Re-sync
          </button>
        );
      case 'published':
        return (
          <span
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid ${btnBorder}`, color: textDim, borderRadius: '6px', opacity: 0.5, whiteSpace: 'nowrap' }}
          >
            ✓ Published
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex-1 overflow-auto pt-2"
        style={{
          paddingLeft: '24px',
          paddingRight: drawerOpen ? '484px' : '24px',
          transition: 'padding-right 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr className="sticky top-0 z-10" style={{ background: estateBg }}>
              <th className="w-9 pl-3.5 py-3 text-left" style={{ borderBottom: `1px solid ${borderColor}` }}>
                <span
                  onClick={toggleAll}
                  className="inline-block w-3.5 h-3.5 rounded-[3px] border cursor-pointer relative"
                  style={{
                    borderColor: allSelected ? goldColor : (btnBorder),
                    backgroundColor: allSelected ? goldColor : 'transparent',
                  }}
                >
                  {allSelected && (
                    <span className="absolute left-[4px] top-[1px] w-[4px] h-[8px] border-r-2 border-b-2 rotate-45" style={{ borderColor: estateBg }} />
                  )}
                </span>
              </th>
              {[
                { label: 'Object Path', align: 'left' },
                { label: 'Kind', align: 'left' },
                { label: 'Lifecycle', align: 'left' },
                { label: 'Rows', align: 'right' },
                { label: 'Last Inventoried', align: 'left' },
                { label: '', align: 'right' },
              ].map((col, i) => (
                <th
                  key={i}
                  className={`py-3 px-3.5 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '9.5px',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    fontWeight: 500,
                    color: textDim,
                    borderBottom: `1px solid ${borderColor}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(12)].map((_, idx) => (
                <tr key={idx}>
                  <td className="p-3.5" style={{ borderBottom: `1px solid ${borderColor}` }}><div className="h-3.5 w-3.5 bg-slate-400/15 rounded" /></td>
                  <td className="p-3.5" style={{ borderBottom: `1px solid ${borderColor}` }}><div className="h-4 bg-slate-400/15 rounded w-4/5" /></td>
                  <td className="p-3.5" style={{ borderBottom: `1px solid ${borderColor}` }}><div className="h-4 bg-slate-400/15 rounded w-14" /></td>
                  <td className="p-3.5" style={{ borderBottom: `1px solid ${borderColor}` }}><div className="h-4 bg-slate-400/15 rounded w-16" /></td>
                  <td className="p-3.5" style={{ borderBottom: `1px solid ${borderColor}` }}><div className="h-4 bg-slate-400/15 rounded w-14 ml-auto" /></td>
                  <td className="p-3.5" style={{ borderBottom: `1px solid ${borderColor}` }}><div className="h-4 bg-slate-400/15 rounded w-16" /></td>
                  <td className="p-3.5" style={{ borderBottom: `1px solid ${borderColor}` }}><div className="h-4 bg-slate-400/15 rounded w-20" /></td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-lg opacity-30 font-mono">◆</span>
                    <span
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: textMuted }}
                    >
                      No objects match your filters
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              items.map(item => {
                const isSelected = selectedPaths.has(item.full_path);
                const parts = item.full_path.split('.');
                const objName = parts.pop() || '';
                const prefix = parts.join('.') + '.';
                const rows = formatRows(item.row_count_est);
                const lc = computeLifecycle(item.live_harvest_state, item.last_t2_at, item.last_knowledge_sync_at, item.last_t0_at, item.last_t1_at, item.last_t3_at, item.has_embedding, item.last_t4_at);

                return (
                  <tr
                    key={item.id}
                    className="transition-colors duration-100"
                    style={{ borderBottom: `1px solid ${borderColor}` }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = hoverBg; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <td className="pl-3.5 py-3">
                      <span
                        onClick={() => toggleOne(item.full_path)}
                        className="inline-block w-3.5 h-3.5 rounded-[3px] border cursor-pointer relative"
                        style={{
                          borderColor: isSelected ? goldColor : (btnBorder),
                          backgroundColor: isSelected ? goldColor : 'transparent',
                        }}
                      >
                        {isSelected && (
                          <span className="absolute left-[4px] top-[1px] w-[4px] h-[8px] border-r-2 border-b-2 rotate-45" style={{ borderColor: estateBg }} />
                        )}
                      </span>
                    </td>
                    <td
                      className="py-3 px-3.5 cursor-pointer max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: inkColor }}
                      onClick={() => handleRowClick(item, lc)}
                      title={item.full_path}
                      onMouseEnter={e => { e.currentTarget.style.color = goldColor; }}
                      onMouseLeave={e => { e.currentTarget.style.color = inkColor; }}
                    >
                      <span style={{ color: textDim }}>{prefix}</span>{objName}
                    </td>
                    <td className="py-3 px-3.5">
                      <span
                        className="inline-flex items-center font-mono text-[9.5px] tracking-wider uppercase px-2 py-1 rounded-md border"
                        style={{ color: textMuted, borderColor: btnBorder }}
                      >
                        {item.object_type}
                      </span>
                    </td>
                    <td className="py-3 px-3.5">
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
                    <td className="py-3 px-3.5 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontVariantNumeric: 'tabular-nums', color: rows ? textSecondary : textDim }}>
                      {rows ?? <span style={{ color: textDim }}>—</span>}
                    </td>
                    <td className="py-3 px-3.5" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: textMuted }}>
                      {formatDate(item.last_inventoried_at)}
                    </td>
                    <td className="py-3 px-3.5" style={{ whiteSpace: 'nowrap' }}>
                      <div className="flex items-center justify-end gap-1.5">
                        <RowAction item={item} />
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); handleRowClick(item, lc); }}
                          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.07em', textTransform: 'uppercase', padding: '4px 10px', border: `1px solid ${btnBorder}`, color: textMuted, borderRadius: '6px', cursor: 'pointer', background: 'transparent', whiteSpace: 'nowrap' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = goldDim; e.currentTarget.style.color = goldColor; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = btnBorder; e.currentTarget.style.color = textMuted; }}
                        >
                          {lc !== 'discovered' && item.context_object_id ? 'View' : 'Cols'}
                        </button>
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
