'use client';

import { Select } from '@/components/form/Select';
import React, { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { CATALOG_SELECT, CATALOG_SELECT_ARROW } from './catalog-ui';

export interface EstateFilterState {
  sourceId?: string;
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
  placeholder?: string;
}

/** Search box shared by both Catalog views. */
export function CatalogSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-ctl border border-[var(--estate-border)] bg-[var(--estate-surface)] px-3 transition-colors focus-within:border-[var(--estate-btn-border)] focus-within:shadow-[var(--focus-ring)]">
      <Search aria-hidden className="size-4 shrink-0 text-[var(--estate-text-dim)]" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-w-0 flex-1 border-none bg-transparent text-ui-regular text-[var(--estate-ink)] outline-none placeholder:text-[var(--estate-text-dim)]"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="rounded-xs p-0.5 text-[var(--estate-text-dim)] hover:text-[var(--estate-ink)]">
          <X className="size-3.5" />
        </button>
      )}
    </label>
  );
}

export default function EstateFilterBar({ filters, onChange, total, placeholder }: EstateFilterBarProps) {
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

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-3">
      <CatalogSearch
        value={searchVal}
        onChange={setSearchVal}
        placeholder={placeholder ?? `Search ${total.toLocaleString()} objects\u2026`}
      />

      <Select
        aria-label="Object type"
        className={CATALOG_SELECT}
        style={CATALOG_SELECT_ARROW}
        value={filters.kind || ''}
        onChange={e => onChange({ kind: e.target.value || undefined })}
      >
        <option value="">Any type</option>
        <option value="MANAGED">Table</option>
        <option value="VIEW">View</option>
        <option value="EXTERNAL">External</option>
      </Select>

      <Select
        aria-label="Stage"
        className={CATALOG_SELECT}
        style={CATALOG_SELECT_ARROW}
        value={filters.lifecycle || ''}
        onChange={e => onChange({ lifecycle: e.target.value || undefined })}
      >
        <option value="">Any stage</option>
        <option value="discovered">Discovered</option>
        <option value="scheduled">Scheduled</option>
        <option value="queued">Queued</option>
        <option value="harvested">Scanned</option>
        <option value="published">Published</option>
        <option value="stale">Needs re-sync</option>
        <option value="inaccessible">No access</option>
      </Select>
    </div>
  );
}