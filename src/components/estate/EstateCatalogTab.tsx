'use client';

import React, { useState, useCallback } from 'react';
import EstateFacetTree from './EstateFacetTree';
import EstateFilterBar, { EstateFilterState } from './EstateFilterBar';
import EstateTable from './EstateTable';
import BulkActionBar from './BulkActionBar';
import PreviewColumnsDrawer from './PreviewColumnsDrawer';
import Pagination from './Pagination';

export default function EstateCatalogTab({ refreshKey = 0, showTestSources = false }: { refreshKey?: number; showTestSources?: boolean }) {
  const [filters, setFilters] = useState<EstateFilterState>({
    catalog: undefined,
    schema: undefined,
    kind: undefined,
    lifecycle: undefined,
    q: undefined,
    page: 1,
    pageSize: 50,
  });

  const [total, setTotal] = useState(0);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPath, setDrawerPath] = useState('');
  const [drawerContextObjectId, setDrawerContextObjectId] = useState<string | null>(null);

  const handleFilterChange = useCallback((updates: Partial<EstateFilterState>) => {
    setFilters(prev => ({ ...prev, ...updates, page: 1 }));
    setSelectedPaths(new Set());
  }, []);

  const handleFacetSelect = useCallback((catalog?: string, schema?: string) => {
    setFilters(prev => ({ ...prev, catalog, schema, page: 1 }));
    setSelectedPaths(new Set());
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }));
    setSelectedPaths(new Set());
  }, []);

  const handleTotalChange = useCallback((t: number) => { setTotal(t); }, []);

  const handlePreviewColumns = useCallback((path: string, contextObjectId?: string | null) => {
    setDrawerPath(path);
    setDrawerContextObjectId(contextObjectId ?? null);
    setDrawerOpen(true);
  }, []);

  const handleHarvest = useCallback(async (paths: string[]) => {
    try {
      const res = await fetch('/api/agent-lab/context/estate/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (!res.ok) throw new Error('Harvest failed');
      setFilters(prev => ({ ...prev }));
    } catch (err) {
      console.error('[EstateCatalogTab] harvest error:', err);
    }
  }, []);

  const handleSyncKnowledge = useCallback(async (paths: string[]) => {
    try {
      const res = await fetch('/api/agent-lab/context/estate/sync-knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (!res.ok) throw new Error('Sync failed');
      setFilters(prev => ({ ...prev }));
    } catch (err) {
      console.error('[EstateCatalogTab] sync-knowledge error:', err);
    }
  }, []);

  const handleScheduleChange = useCallback(async (
    action: 'include' | 'exclude',
    scope: { paths?: string[]; schemas?: string[]; catalogs?: string[] },
  ) => {
    try {
      const res = await fetch('/api/agent-lab/context/estate/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, scope }),
      });
      if (!res.ok) throw new Error('Schedule change failed');
      setFilters(prev => ({ ...prev }));
    } catch (err) {
      console.error('[EstateCatalogTab] schedule error:', err);
    }
  }, []);

  const handleBulkHarvest = useCallback(() => {
    const paths = Array.from(selectedPaths);
    if (paths.length > 0) {
      handleHarvest(paths);
      setSelectedPaths(new Set());
    }
  }, [selectedPaths, handleHarvest]);

  const handleBulkSchedule = useCallback(() => {
    const paths = Array.from(selectedPaths);
    if (paths.length > 0) {
      handleScheduleChange('include', { paths });
      setSelectedPaths(new Set());
    }
  }, [selectedPaths, handleScheduleChange]);

  const handleBulkUnschedule = useCallback(() => {
    const paths = Array.from(selectedPaths);
    if (paths.length > 0) {
      handleScheduleChange('exclude', { paths });
      setSelectedPaths(new Set());
    }
  }, [selectedPaths, handleScheduleChange]);

  const handleScheduleCatalog = useCallback((action: 'include' | 'exclude') => {
    if (filters.catalog) {
      if (filters.schema) {
        handleScheduleChange(action, { schemas: [`${filters.catalog}.${filters.schema}`] });
      } else {
        handleScheduleChange(action, { catalogs: [filters.catalog] });
      }
    }
  }, [filters.catalog, filters.schema, handleScheduleChange]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <EstateFacetTree
        selectedCatalog={filters.catalog}
        selectedSchema={filters.schema}
        onSelect={handleFacetSelect}
        total={total}
        refreshKey={refreshKey}
        showTestSources={showTestSources}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <EstateFilterBar filters={filters} onChange={handleFilterChange} total={total} />

        <BulkActionBar
          count={selectedPaths.size}
          onHarvest={handleBulkHarvest}
          onSchedule={handleBulkSchedule}
          onUnschedule={handleBulkUnschedule}
          onScheduleCatalog={handleScheduleCatalog}
          catalogScope={filters.catalog ? (filters.schema ? `${filters.catalog}.${filters.schema}` : filters.catalog) : undefined}
          onClear={() => setSelectedPaths(new Set())}
        />

        <EstateTable
          filters={filters}
          onTotalChange={handleTotalChange}
          selectedPaths={selectedPaths}
          onSelectionChange={setSelectedPaths}
          onPreviewColumns={handlePreviewColumns}
          onHarvest={handleHarvest}
          onSyncKnowledge={handleSyncKnowledge}
          onScheduleChange={handleScheduleChange}
          drawerOpen={drawerOpen}
          refreshKey={refreshKey}
          showTestSources={showTestSources}
        />

        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={handlePageChange}
        />
      </div>

      <PreviewColumnsDrawer
        open={drawerOpen}
        path={drawerPath}
        contextObjectId={drawerContextObjectId}
        onClose={() => setDrawerOpen(false)}
        onHarvest={handleHarvest}
      />
    </div>
  );
}
