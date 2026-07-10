'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface ColumnItem {
  id: string;
  name: string;
  data_type: string | null;
  ordinal: number | null;
  native_comment: string | null;
  profile: any;
  semantic: any;
}

interface ColumnsTableProps {
  columns: ColumnItem[];
  focusColumn?: string | null;
  onFocusClear?: () => void;
}

function formatNullRate(rate: any): string {
  if (rate === null || rate === undefined) return '—';
  const val = Number(rate);
  if (isNaN(val)) return '—';
  return `${(val * 100).toFixed(1)}%`;
}

function formatDistinct(distinct: any): string {
  if (distinct === null || distinct === undefined) return '—';
  const val = Number(distinct);
  if (isNaN(val)) return '—';
  return val.toLocaleString();
}

function formatTopK(topK: any): string[] {
  if (!Array.isArray(topK) || topK.length === 0) return [];
  return topK.map((item: any) => {
    if (item && typeof item === 'object') {
      return item.value !== undefined ? String(item.value) : JSON.stringify(item);
    }
    return String(item);
  });
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ backgroundColor: 'rgba(253,181,21,0.22)', color: 'inherit', borderRadius: '2px', padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function RoleBadge({ role }: { role: string }) {
  const roleColors: Record<string, { bg: string; text: string; border: string }> = {
    key:       { bg: 'rgba(253,181,21,0.10)',   text: '#FDB515', border: 'rgba(253,181,21,0.3)' },
    fk_ref:    { bg: 'rgba(91,157,255,0.10)',   text: '#5B9DFF', border: 'rgba(91,157,255,0.3)' },
    dimension: { bg: 'rgba(139,92,246,0.10)',   text: '#A78BFA', border: 'rgba(139,92,246,0.3)' },
    measure:   { bg: 'rgba(34,197,94,0.10)',    text: '#4ADE80', border: 'rgba(34,197,94,0.3)' },
    timestamp: { bg: 'rgba(251,146,60,0.10)',   text: '#FB923C', border: 'rgba(251,146,60,0.3)' },
    other:     { bg: 'rgba(136,146,164,0.06)',  text: '#8892A4', border: 'rgba(136,146,164,0.2)' },
  };
  const style = roleColors[role] || roleColors.other;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tracking-wide whitespace-nowrap"
      style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
    >
      {role}
    </span>
  );
}

interface ColumnRowProps {
  col: ColumnItem;
  idx: number;
  searchQuery: string;
  highlighted: boolean;
  rowRef?: React.Ref<HTMLTableRowElement>;
}

function ColumnRow({ col, idx, searchQuery, highlighted, rowRef }: ColumnRowProps) {
  const [expanded, setExpanded] = useState(false);

  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const borderColor = 'var(--estate-border-gold)';

  const profile = col.profile || {};
  const semantic = col.semantic || {};

  const isPii = semantic.pii_flag === true;
  const role = semantic.role || '—';
  const description = semantic.description || col.native_comment || '';
  const descriptionIsNative = !semantic.description && !!col.native_comment;
  const confidence = typeof semantic.confidence === 'number' ? semantic.confidence : null;
  const topValues = formatTopK(profile.top_k);
  const hasDescription = description.length > 0;
  const isLongDesc = description.length > 60;

  const rowBg = highlighted
    ? 'rgba(253,181,21,0.07)'
    : idx % 2 === 0
      ? 'var(--estate-row-even, var(--estate-raised))'
      : 'var(--estate-row-odd, var(--estate-bg))';

  return (
    <>
      <tr
        ref={rowRef}
        style={{
          backgroundColor: rowBg,
          borderBottom: `1px solid ${borderColor}`,
          outline: highlighted ? '1.5px solid rgba(253,181,21,0.4)' : 'none',
          outlineOffset: '-1px',
          transition: 'background-color 0.4s ease, outline 0.4s ease',
        }}
        className="group transition-colors duration-100 hover:brightness-105"
        onClick={() => isLongDesc && setExpanded(!expanded)}
        role={isLongDesc ? 'button' : undefined}
      >
        {/* Name */}
        <td className="px-4 py-2.5 font-mono text-[12px] font-semibold whitespace-nowrap align-middle" style={{ color: inkColor }}>
          <div className="flex items-center gap-2">
            {isLongDesc && (
              <span
                className="inline-flex w-4 h-4 items-center justify-center text-[10px] transition-transform duration-150 select-none opacity-50 group-hover:opacity-100"
                style={{ color: labelColor, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                ▶
              </span>
            )}
            <span>
              <Highlight text={col.name} query={searchQuery} />
            </span>
          </div>
        </td>
        {/* Type */}
        <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap align-middle" style={{ color: mutedColor }}>
          {col.data_type || '—'}
        </td>
        {/* Role */}
        <td className="px-4 py-2.5 align-middle">
          {role !== '—' ? <RoleBadge role={role} /> : <span className="text-[11px]" style={{ color: mutedColor }}>—</span>}
        </td>
        {/* Null% */}
        <td className="px-4 py-2.5 text-right font-mono text-[12px] whitespace-nowrap tabular-nums align-middle" style={{ color: inkColor }}>
          {formatNullRate(profile.null_rate)}
        </td>
        {/* Distinct */}
        <td className="px-4 py-2.5 text-right font-mono text-[12px] whitespace-nowrap tabular-nums align-middle" style={{ color: inkColor }}>
          {formatDistinct(profile.distinct_est)}
        </td>
        {/* Top Values */}
        <td className="px-4 py-2.5 align-middle">
          {isPii ? (
            <span className="text-red-500/80 dark:text-red-400/80 text-[11px] font-medium select-none inline-flex items-center gap-1">
              <span>⚑</span> PII
            </span>
          ) : topValues.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {topValues.slice(0, 3).map((v, i) => (
                <span
                  key={i}
                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono truncate max-w-[90px]"
                  style={{ backgroundColor: 'rgba(136,146,164,0.08)', color: mutedColor, border: '1px solid rgba(136,146,164,0.12)' }}
                  title={v}
                >
                  {v}
                </span>
              ))}
              {topValues.length > 3 && (
                <span className="text-[10px] font-mono" style={{ color: mutedColor }}>
                  +{topValues.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px]" style={{ color: mutedColor }}>—</span>
          )}
        </td>
        {/* Description */}
        <td className="px-4 py-2.5 font-sans text-[12px] leading-relaxed align-middle" style={{ color: labelColor }}>
          {hasDescription ? (
            <span className={isLongDesc && !expanded ? 'line-clamp-2' : ''}>
              {descriptionIsNative && (
                <span
                  title="Fallback to native column comment — no semantic description yet"
                  style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 8,
                    fontWeight: 600,
                    padding: '1px 4px',
                    borderRadius: 2,
                    background: 'rgba(224,178,60,0.12)',
                    color: '#e0b23c',
                    border: '1px solid rgba(224,178,60,0.3)',
                    marginRight: 5,
                    letterSpacing: '0.08em',
                    verticalAlign: 'middle',
                  }}
                >
                  native
                </span>
              )}
              <Highlight text={description} query={searchQuery} />
            </span>
          ) : (
            <span className="italic text-[11px]" style={{ color: mutedColor }}>No description</span>
          )}
        </td>
        {/* Confidence */}
        <td className="px-4 py-2.5 align-middle">
          {confidence !== null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div
                style={{
                  width: 30,
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(136,146,164,0.15)',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: `${Math.round(confidence * 100)}%`,
                    height: '100%',
                    background: 'var(--confirmed-color, #2F6DB0)',
                    borderRadius: 2,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 10,
                  color: mutedColor,
                }}
              >
                {Math.round(confidence * 100)}
              </span>
            </div>
          ) : (
            <span className="text-[11px]" style={{ color: mutedColor }}>—</span>
          )}
        </td>
      </tr>
      {expanded && isLongDesc && (
        <tr style={{ backgroundColor: rowBg }}>
          <td
            colSpan={8}
            className="px-4 pb-4 pt-0"
            style={{ borderBottom: `1px solid ${borderColor}` }}
          >
            <div
              className="ml-6 pl-4 py-3 rounded font-sans text-[12px] leading-relaxed"
              style={{
                color: labelColor,
                backgroundColor: 'rgba(136,146,164,0.04)',
                borderLeft: '2px solid rgba(253,181,21,0.3)',
              }}
            >
              {description}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

type SortField = 'ordinal' | 'name' | 'null_rate' | 'distinct_est';
type SortDir = 'asc' | 'desc';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export default function ColumnsTable({ columns, focusColumn, onFocusClear }: ColumnsTableProps) {
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const borderColor = 'var(--estate-border-gold)';
  const thBg = 'var(--estate-bg)';
  const raisedBg = 'var(--estate-raised)';
  const inkColor = 'var(--estate-ink)';

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [piiFilter, setPiiFilter] = useState<'all' | 'pii' | 'non-pii'>('all');
  const [sortField, setSortField] = useState<SortField>('ordinal');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Keyboard shortcut: "/" focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // External focus: when focusColumn changes, set search, scroll + highlight
  useEffect(() => {
    if (!focusColumn) return;
    setSearchQuery(focusColumn);
    // Defer scroll until after render
    const timer = setTimeout(() => {
      const col = columns.find((c) => c.name === focusColumn);
      if (!col) return;
      setHighlightedId(col.id);
      rowRefs.current[col.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Clear pulse after 2s
      const clearTimer = setTimeout(() => {
        setHighlightedId(null);
        onFocusClear?.();
      }, 2000);
      return () => clearTimeout(clearTimer);
    }, 80);
    return () => clearTimeout(timer);
  }, [focusColumn, columns, onFocusClear]);

  // Collect distinct roles for the role filter dropdown
  const distinctRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const col of columns) {
      const r = col.semantic?.role;
      if (r && typeof r === 'string') roles.add(r);
    }
    return Array.from(roles).sort();
  }, [columns]);

  // Filter + sort pipeline
  const filteredColumns = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let result = columns.filter((col) => {
      const profile = col.profile || {};
      const semantic = col.semantic || {};
      const isPii = semantic.pii_flag === true;
      const role = semantic.role || '';
      const description = semantic.description || col.native_comment || '';
      const topValues = formatTopK(profile.top_k);

      if (piiFilter === 'pii' && !isPii) return false;
      if (piiFilter === 'non-pii' && isPii) return false;
      if (roleFilter && role !== roleFilter) return false;
      if (q) {
        const haystack = [
          col.name,
          col.data_type || '',
          role,
          description,
          ...topValues,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'ordinal') {
        cmp = (a.ordinal ?? 0) - (b.ordinal ?? 0);
      } else if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'null_rate') {
        const ar = a.profile?.null_rate ?? -1;
        const br = b.profile?.null_rate ?? -1;
        cmp = ar - br;
      } else if (sortField === 'distinct_est') {
        const ad = a.profile?.distinct_est ?? -1;
        const bd = b.profile?.distinct_est ?? -1;
        cmp = ad - bd;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [columns, searchQuery, roleFilter, piiFilter, sortField, sortDir]);

  const handleSortToggle = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
    setCurrentPage(1);
  }, []);

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return <span style={{ opacity: 0.3 }}>⇅</span>;
    return <span style={{ color: '#FDB515' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const selectStyle: React.CSSProperties = {
    fontFamily: "'Inter Tight', sans-serif",
    fontSize: '12px',
    backgroundColor: raisedBg,
    border: `1px solid ${borderColor}`,
    borderRadius: '4px',
    color: inkColor,
    padding: '5px 24px 5px 8px',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%238892A4' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
  };

  const isFiltered = searchQuery || roleFilter || piiFilter !== 'all';
  const totalFiltered = filteredColumns.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalFiltered);
  const pagedColumns = filteredColumns.slice(startIdx, endIdx);

  const footerLabel = isFiltered
    ? `Showing ${totalFiltered === 0 ? 0 : startIdx + 1}–${endIdx} of ${totalFiltered} (filtered from ${columns.length})`
    : `Showing ${totalFiltered === 0 ? 0 : startIdx + 1}–${endIdx} of ${columns.length} column${columns.length !== 1 ? 's' : ''}`;

  const sortLabel = sortField !== 'ordinal'
    ? ` · sorted by ${sortField.replace('_', ' ')} ${sortDir}`
    : '';

  if (columns.length === 0) {
    return (
      <div
        className="border rounded overflow-hidden shadow-sm"
        style={{ borderColor }}
      >
        {/* Toolbar */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ backgroundColor: thBg, borderColor }}
        >
          <span className="font-mono text-[10px] tracking-wider uppercase font-bold" style={{ color: labelColor }}>
            Columns Schema
          </span>
        </div>
        <div className="border-dashed rounded p-8 text-center" style={{ borderColor }}>
          <p className="text-xs italic font-sans" style={{ color: labelColor }}>
            No column metadata available yet. Run a profile to populate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded overflow-hidden shadow-sm" style={{ borderColor }}>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-3 border-b"
        style={{ backgroundColor: thBg, borderColor }}
      >
        {/* Section label */}
        <span className="font-mono text-[10px] tracking-wider uppercase font-bold shrink-0" style={{ color: labelColor }}>
          Columns Schema
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search input */}
        <div
          className="flex items-center gap-2 h-8 px-2.5 rounded border transition-colors duration-150"
          style={{ backgroundColor: raisedBg, borderColor, minWidth: '200px' }}
          onFocusCapture={(e) => { e.currentTarget.style.borderColor = '#FDB515'; }}
          onBlurCapture={(e) => { e.currentTarget.style.borderColor = borderColor; }}
        >
          <span className="select-none text-[13px]" style={{ color: mutedColor }}>⌕</span>
          <input
            ref={searchRef}
            type="text"
            placeholder={`Search ${columns.length} columns… (/)`}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="flex-1 bg-transparent border-none outline-none text-[12px]"
            style={{ color: inkColor, fontFamily: "'Inter Tight', sans-serif", minWidth: 0 }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}
              className="text-[11px] opacity-60 hover:opacity-100 transition-opacity leading-none"
              style={{ color: mutedColor }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Role filter */}
        <div className="relative shrink-0">
          <select
            style={selectStyle}
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setCurrentPage(1); }}
          >
            <option value="">Role: All</option>
            {distinctRoles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {/* PII filter */}
        <div className="relative shrink-0">
          <select
            style={selectStyle}
            value={piiFilter}
            onChange={(e) => { setPiiFilter(e.target.value as 'all' | 'pii' | 'non-pii'); setCurrentPage(1); }}
          >
            <option value="all">PII: All</option>
            <option value="pii">PII only</option>
            <option value="non-pii">Non-PII</option>
          </select>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs text-left" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr
              className="sticky top-0 z-10 border-b select-none"
              style={{ backgroundColor: thBg, borderColor }}
            >
              {/* Sortable: Name */}
              <th
                className="px-4 py-2.5 font-mono text-[9px] font-bold tracking-widest uppercase cursor-pointer hover:text-[#FDB515] transition-colors"
                style={{ color: labelColor }}
                onClick={() => handleSortToggle('name')}
              >
                <span className="flex items-center gap-1">Name {sortIndicator('name')}</span>
              </th>
              <th className="px-4 py-2.5 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Type</th>
              <th className="px-4 py-2.5 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Role</th>
              {/* Sortable: Null% */}
              <th
                className="px-4 py-2.5 font-mono text-[9px] font-bold tracking-widest uppercase text-right cursor-pointer hover:text-[#FDB515] transition-colors"
                style={{ color: labelColor }}
                onClick={() => handleSortToggle('null_rate')}
              >
                <span className="flex items-center justify-end gap-1">Null% {sortIndicator('null_rate')}</span>
              </th>
              {/* Sortable: Distinct */}
              <th
                className="px-4 py-2.5 font-mono text-[9px] font-bold tracking-widest uppercase text-right cursor-pointer hover:text-[#FDB515] transition-colors"
                style={{ color: labelColor }}
                onClick={() => handleSortToggle('distinct_est')}
              >
                <span className="flex items-center justify-end gap-1">Distinct {sortIndicator('distinct_est')}</span>
              </th>
              <th className="px-4 py-2.5 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Top Values</th>
              <th className="px-4 py-2.5 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Description</th>
              <th className="px-4 py-2.5 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }} title="Semantic annotation confidence">Conf</th>
            </tr>
          </thead>
          <tbody>
            {filteredColumns.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center font-sans text-xs italic"
                  style={{ color: mutedColor }}
                >
                  No columns match your search{roleFilter ? ` with role "${roleFilter}"` : ''}{piiFilter !== 'all' ? ` (${piiFilter})` : ''}.
                </td>
              </tr>
            ) : (
              pagedColumns.map((col, idx) => (
                <ColumnRow
                  key={col.id}
                  col={col}
                  idx={startIdx + idx}
                  searchQuery={searchQuery}
                  highlighted={highlightedId === col.id}
                  rowRef={(el) => { rowRefs.current[col.id] = el; }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer with Pagination ──────────────────────────────── */}
      <div
        className="px-4 py-2.5 border-t flex items-center justify-between gap-4 flex-wrap"
        style={{ borderColor, backgroundColor: thBg }}
      >
        {/* Left: count info */}
        <span
          className="font-mono text-[11px]"
          style={{ color: isFiltered ? '#FDB515' : labelColor }}
        >
          {footerLabel}{sortLabel}
        </span>

        {/* Center: pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage <= 1}
              className="font-mono text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-30"
              style={{
                backgroundColor: 'transparent',
                borderColor,
                color: labelColor,
                cursor: safeCurrentPage <= 1 ? 'not-allowed' : 'pointer',
              }}
              aria-label="First page"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safeCurrentPage <= 1}
              className="font-mono text-[11px] px-2.5 py-1 rounded border transition-colors disabled:opacity-30"
              style={{
                backgroundColor: 'transparent',
                borderColor,
                color: labelColor,
                cursor: safeCurrentPage <= 1 ? 'not-allowed' : 'pointer',
              }}
              aria-label="Previous page"
            >
              ‹
            </button>

            {/* Page number pills — show up to 5 */}
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const half = Math.floor(Math.min(totalPages, 5) / 2);
              let start = Math.max(1, safeCurrentPage - half);
              const end = Math.min(totalPages, start + 4);
              start = Math.max(1, end - 4);
              return start + i;
            }).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className="font-mono text-[11px] w-7 h-7 rounded border transition-colors"
                style={{
                  backgroundColor: page === safeCurrentPage ? 'rgba(253,181,21,0.12)' : 'transparent',
                  borderColor: page === safeCurrentPage ? '#FDB515' : borderColor,
                  color: page === safeCurrentPage ? '#FDB515' : labelColor,
                  cursor: 'pointer',
                }}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage >= totalPages}
              className="font-mono text-[11px] px-2.5 py-1 rounded border transition-colors disabled:opacity-30"
              style={{
                backgroundColor: 'transparent',
                borderColor,
                color: labelColor,
                cursor: safeCurrentPage >= totalPages ? 'not-allowed' : 'pointer',
              }}
              aria-label="Next page"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage >= totalPages}
              className="font-mono text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-30"
              style={{
                backgroundColor: 'transparent',
                borderColor,
                color: labelColor,
                cursor: safeCurrentPage >= totalPages ? 'not-allowed' : 'pointer',
              }}
              aria-label="Last page"
            >
              »
            </button>
          </div>
        )}

        {/* Right: page size selector + keyboard hint */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px]" style={{ color: mutedColor }}>Rows:</span>
            <select
              style={{ ...selectStyle, fontSize: '11px', padding: '3px 22px 3px 6px' }}
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
            >
              {PAGE_SIZE_OPTIONS.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <span className="font-mono text-[10px] opacity-50" style={{ color: mutedColor }}>
            / to search
          </span>
        </div>
      </div>
    </div>
  );
}
