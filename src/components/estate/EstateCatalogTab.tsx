'use client';

import React, { useState, useCallback, useEffect } from 'react';
import EstateFacetTree from './EstateFacetTree';
import EstateFilterBar, { EstateFilterState } from './EstateFilterBar';
import EstateTable from './EstateTable';
import BulkActionBar from './BulkActionBar';
import PreviewColumnsDrawer from './PreviewColumnsDrawer';
import Pagination from './Pagination';
import { isTestSourceDisplayName } from '@/lib/context/test-sources';
import { buildCatalogPipelineLaunchBody, resolveCatalogPipelineScope } from '@/lib/estate/catalog-pipeline';
import { toast } from 'sonner';

export default function EstateCatalogTab({ refreshKey = 0, showTestSources = false }: { refreshKey?: number; showTestSources?: boolean }) {
  const [filters, setFilters] = useState<EstateFilterState>({
    sourceId: undefined,
    catalog: undefined,
    schema: undefined,
    kind: undefined,
    lifecycle: undefined,
    q: undefined,
    page: 1,
    pageSize: 50,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent-lab/context/sources');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const list = Array.isArray(data.sources) ? data.sources : [];
        const pick = list.find(
          (s: { display_name?: string | null; status?: string }) =>
            s.status === 'active' && (showTestSources || !isTestSourceDisplayName(s.display_name)),
        );
        if (pick?.id && !cancelled) {
          setFilters(prev => (prev.sourceId ? prev : { ...prev, sourceId: pick.id }));
        }
      } catch {
        // estate list remains org-wide until source resolves
      }
    })();
    return () => { cancelled = true; };
  }, [showTestSources]);

  const [total, setTotal] = useState(0);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPath, setDrawerPath] = useState('');
  const [drawerContextObjectId, setDrawerContextObjectId] = useState<string | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);

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

  const handleRunPipeline = useCallback(async () => {
    if (!filters.catalog || pipelineRunning) return;
    const { label } = resolveCatalogPipelineScope(filters.catalog, filters.schema);
    const body = buildCatalogPipelineLaunchBody(
      filters.catalog,
      filters.schema,
      filters.sourceId,
    );
    setPipelineRunning(true);
    try {
      const res = await fetch('/api/agent-lab/context/jobs/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data.message === 'string'
            ? data.message
            : typeof data.error === 'string'
              ? data.error
              : 'Launch failed';
        toast.error('Pipeline launch failed', { description: msg });
        return;
      }
      const steps = 'T0 → T1 → T2';
      toast.success(`Pipeline started for ${label}`, {
        description: `${steps} sequential on Fargate · Limit ${body.includePatterns[0]}`,
      });
    } catch (err) {
      console.error('[EstateCatalogTab] pipeline launch error:', err);
      toast.error('Pipeline launch failed', { description: 'Network error' });
    } finally {
      setPipelineRunning(false);
    }
  }, [filters.catalog, filters.schema, filters.sourceId, pipelineRunning]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <EstateFacetTree
        sourceId={filters.sourceId}
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
          onRunPipeline={filters.catalog ? handleRunPipeline : undefined}
          pipelineRunning={pipelineRunning}
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
