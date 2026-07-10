'use client';

import React, { useState, useEffect, useCallback } from 'react';

export interface EstateFilterState {
  catalog?: string;
  schema?: string;
  kind?: string;
  lifecycle?: string;
  q?: string;
  page: number;
  pageSize: number;
}

interface EstateFilterBarProps {
  filters: EstateFilterState;
  onChange: (updates: Partial<EstateFilterState>) => void;
  total: number;
}

export default function EstateFilterBar({ filters, onChange, total }: EstateFilterBarProps) {
  const [searchVal, setSearchVal] = useState(filters.q || '');

  const stableOnChange = useCallback(onChange, [onChange]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (filters.q !== (searchVal || undefined)) {
        stableOnChange({ q: searchVal || undefined });
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [searchVal, stableOnChange, filters.q]);

  useEffect(() => {
    setSearchVal(filters.q || '');
  }, [filters.q]);

  const borderColor = 'var(--estate-border)';
  const surfaceBg = 'var(--estate-surface)';
  const inkColor = 'var(--estate-ink)';
  const textMuted = 'var(--estate-text-dim)';
  const textSecondary = 'var(--estate-text-secondary)';

  const selectStyle: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '12px',
    letterSpacing: '0.04em',
    backgroundColor: surfaceBg,
    border: `1px solid ${borderColor}`,
    borderRadius: '6px',
    color: textSecondary,
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
    <div
      className="flex items-center gap-3 px-6 py-3.5 flex-wrap"
      style={{ background: 'var(--estate-bg)' }}
    >
      {/* Search */}
      <div
        className="flex-1 min-w-[240px] flex items-center gap-2 h-9 px-3"
        style={{
          backgroundColor: surfaceBg,
          border: `1px solid ${borderColor}`,
          borderRadius: '6px',
        }}
        onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--estate-btn-border)'; }}
        onBlurCapture={e => { e.currentTarget.style.borderColor = borderColor; }}
      >
        <span style={{ color: textMuted, fontSize: '14px' }}>⌕</span>
        <input
          type="text"
          placeholder={`Search ${total} objects across the estate…`}
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
        onChange={e => onChange({ kind: e.target.value || undefined })}
      >
        <option value="">Kind: All</option>
        <option value="MANAGED">Table</option>
        <option value="VIEW">View</option>
        <option value="EXTERNAL">External</option>
      </select>

      {/* Lifecycle filter */}
      <select
        style={selectStyle}
        value={filters.lifecycle || ''}
        onChange={e => onChange({ lifecycle: e.target.value || undefined })}
      >
        <option value="">Lifecycle: All</option>
        <option value="discovered">Discovered</option>
        <option value="scheduled">Scheduled</option>
        <option value="queued">Queued</option>
        <option value="harvested">Harvested</option>
        <option value="published">Published</option>
        <option value="stale">Stale</option>
        <option value="inaccessible">No Access</option>
      </select>
    </div>
  );
}
