'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FacetTreeView, type TreeCatalog, type TreeSchema } from './catalog-ui';

interface EstateFacetTreeProps {
  sourceId?: string;
  selectedCatalog?: string;
  selectedSchema?: string;
  onSelect: (catalog?: string, schema?: string) => void;
  total: number;
  refreshKey?: number;
  showTestSources?: boolean;
}

/** Catalog → schema tree for "All objects", with a scanned-coverage bar per row. */
export default function EstateFacetTree({ sourceId, selectedCatalog, selectedSchema, onSelect, total, refreshKey = 0, showTestSources = false }: EstateFacetTreeProps) {
  const [catalogs, setCatalogs] = useState<TreeCatalog[]>([]);
  const [schemas, setSchemas] = useState<TreeSchema[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFacets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (!showTestSources) params.append('excludeTestSources', 'true');
      if (sourceId) params.append('sourceId', sourceId);
      const res = await fetch(`/api/agent-lab/context/estate/facets?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setCatalogs(data.catalogs ?? []);
      setSchemas(data.schemas ?? []);
    } catch {
      // tree stays empty; table still works org-wide
    } finally {
      setLoading(false);
    }
  }, [showTestSources, sourceId]);

  useEffect(() => { void fetchFacets(); }, [fetchFacets, refreshKey]);

  return (
    <FacetTreeView
      title="Catalogs"
      allLabel="All catalogs"
      total={total}
      catalogs={catalogs}
      schemas={schemas}
      loading={loading}
      selectedCatalog={selectedCatalog}
      selectedSchema={selectedSchema}
      onSelect={onSelect}
      showCoverage
      footnote={catalogs.length > 0 ? 'Bars show how much of each catalog has been scanned.' : undefined}
    />
  );
}