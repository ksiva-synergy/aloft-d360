'use client';

import React, { useState, useEffect } from 'react';

export interface FilterState {
  sourceId?: string;
  catalog?: string;
  schema?: string;
  q?: string;
  status?: string;
  stale?: boolean;
  neverProfiled?: boolean;
  hasPii?: boolean;
  page: number;
  pageSize: number;
}

interface FilterBarProps {
  filters: FilterState;
  onChange: (updates: Partial<FilterState>) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const [searchVal, setSearchVal] = useState(filters.q || '');
  const [semanticOn, setSemanticOn] = useState(false);

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      if (filters.q !== searchVal) {
        onChange({ q: searchVal || undefined });
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchVal, onChange, filters.q]);

  // Sync state if filters.q changes externally (e.g., reset)
  useEffect(() => {
    setSearchVal(filters.q || '');
  }, [filters.q]);

  const inkColor = 'var(--estate-ink)';
  const raisedBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';
  const labelColor = 'var(--estate-text-secondary)';

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

  const handleFocus = (e: React.FocusEvent<HTMLSelectElement>) => {
    e.target.style.borderColor = '#FDB515';
  };

  const handleBlur = (e: React.FocusEvent<HTMLSelectElement>) => {
    e.target.style.borderColor = borderColor;
  };

  return (
    <div
      className="flex items-center gap-2.5 py-3 px-4 border-b shrink-0 transition-colors duration-200 bg-[var(--background)]"
      style={{ borderColor }}
    >
      {/* Search Input */}
      <div
        className="flex-1 flex items-center gap-2 px-3 border rounded h-9 transition-all duration-200"
        style={{
          backgroundColor: raisedBg,
          borderColor: borderColor,
        }}
        onFocusCapture={(e) => {
          e.currentTarget.style.borderColor = '#FDB515';
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderColor = borderColor;
        }}
      >
        <span style={{ color: labelColor }} className="text-sm select-none">⌕</span>
        <input
          type="text"
          placeholder="Search objects..."
          value={searchVal}
          onChange={(e) => setSearchVal(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-xs transition-colors duration-200"
          style={{ color: inkColor, fontFamily: "'Inter Tight', sans-serif" }}
        />
      </div>

      {/* Semantic Toggle switch */}
      <div className="flex items-center gap-2 select-none shrink-0">
        <span
          className="text-xs font-medium flex items-center gap-1.5"
          style={{ color: labelColor, fontFamily: "'Inter Tight', sans-serif" }}
        >
          {semanticOn && <span className="w-1.5 h-1.5 rounded-full bg-[#FDB515]" />}
          Semantic
        </span>
        <button
          type="button"
          onClick={() => setSemanticOn(!semanticOn)}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none items-center"
          style={{
            backgroundColor: semanticOn ? 'rgba(253, 181, 21, 0.2)' : 'var(--estate-raised)',
            border: `1px solid ${semanticOn ? '#FDB515' : borderColor}`,
          }}
        >
          <span
            className="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full transition duration-200 ease-in-out"
            style={{
              backgroundColor: semanticOn ? '#FDB515' : 'var(--estate-text-muted)',
              transform: semanticOn ? 'translateX(16px)' : 'translateX(2px)',
            }}
          />
        </button>
      </div>

      {/* Dropdown Filters */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Status */}
        <div className="flex items-center gap-1.5">
          <span style={{ color: labelColor, fontFamily: "'Inter Tight', sans-serif", fontSize: '11px' }} className="select-none font-medium">Status</span>
          <select
            style={selectStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
            value={filters.status || 'All'}
            onChange={(e) =>
              onChange({ status: e.target.value === 'All' ? undefined : e.target.value })
            }
          >
            <option value="All">All</option>
            <option value="assumed">assumed</option>
            <option value="confirmed">confirmed</option>
            <option value="certified">certified</option>
          </select>
        </div>

        {/* Freshness */}
        <div className="flex items-center gap-1.5">
          <span style={{ color: labelColor, fontFamily: "'Inter Tight', sans-serif", fontSize: '11px' }} className="select-none font-medium">Freshness</span>
          <select
            style={selectStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
            value={
              filters.neverProfiled
                ? 'Never profiled'
                : filters.stale
                ? 'Stale'
                : 'All'
            }
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'Stale') {
                onChange({ stale: true, neverProfiled: undefined });
              } else if (val === 'Never profiled') {
                onChange({ stale: true, neverProfiled: true });
              } else {
                onChange({ stale: undefined, neverProfiled: undefined });
              }
            }}
          >
            <option value="All">All</option>
            <option value="Stale">Stale</option>
            <option value="Never profiled">Never profiled</option>
          </select>
        </div>

        {/* PII */}
        <div className="flex items-center gap-1.5">
          <span style={{ color: labelColor, fontFamily: "'Inter Tight', sans-serif", fontSize: '11px' }} className="select-none font-medium">PII</span>
          <select
            style={selectStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
            value={filters.hasPii ? 'Has PII' : 'All'}
            onChange={(e) =>
              onChange({ hasPii: e.target.value === 'Has PII' ? true : undefined })
            }
          >
            <option value="All">All</option>
            <option value="Has PII">Has PII</option>
          </select>
        </div>
      </div>
    </div>
  );
}

