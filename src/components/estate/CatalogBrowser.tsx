'use client';

import React, { useState, useCallback } from 'react';
import CatalogTree from './CatalogTree';
import FilterBar, { FilterState } from './FilterBar';
import ObjectTable from './ObjectTable';
import Pagination from './Pagination';

export default function CatalogBrowser() {
  const [filters, setFilters] = useState<FilterState>({
    sourceId: undefined,
    catalog: undefined,
    schema: undefined,
    q: undefined,
    status: undefined,
    stale: undefined,
    neverProfiled: undefined,
    hasPii: undefined,
    page: 1,
    pageSize: 25,
  });

  const [total, setTotal] = useState(0);

  const handleFilterChange = useCallback((updates: Partial<FilterState>) => {
    setFilters((prev) => ({
      ...prev,
      ...updates,
      page: 1, // Reset page to 1 on any filter change
    }));
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setFilters((prev) => ({
      ...prev,
      page: newPage,
    }));
  }, []);

  const handleTotalChange = useCallback((newTotal: number) => {
    setTotal(newTotal);
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--background)]">
      {/* Left Panel: Tree Navigator */}
      <CatalogTree filters={filters} onChange={handleFilterChange} />

      {/* Right Panel: Search, Filters, Table and Pagination */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Search & Filter Bar */}
        <FilterBar filters={filters} onChange={handleFilterChange} />

        {/* Object Table */}
        <ObjectTable filters={filters} onTotalChange={handleTotalChange} />

        {/* Pagination Bar */}
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
