'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FacetTreeView, type TreeCatalog, type TreeSchema } from './catalog-ui';

interface FacetSchema {
  catalog: string;
  name: string;
  count: number;
  needs_profile?: number;
  needs_enrich?: number;
  needs_embed?: number;
}

interface ScannedFacetTreeProps {
  selectedCatalog?: string;
  selectedSchema?: string;
  pipelineSchemaKeys?: Set<string>;
  onTogglePipelineSchema?: (catalog: string, schema: string) => void;
  onSelect: (catalog?: string, schema?: string) => void;
  total: number;
  refreshKey?: number;
  showTestSources?: boolean;
}

function schemaHint(s: FacetSchema): string | undefined {
  const parts = [
    s.needs_profile ? `${s.needs_profile} need profiling` : null,
    s.needs_enrich ? `${s.needs_enrich} need a description` : null,
    s.needs_embed ? `${s.needs_embed} not yet searchable` : null,
  ].filter(Boolean);
  return parts.length ? `${s.catalog}.${s.name} \u2014 ${parts.join(', ')}` : undefined;
}

/** Catalog → schema tree for "Scanned"; optional schema checkboxes feed "Continue pipeline". */
export default function ScannedFacetTree({
  selectedCatalog,
  selectedSchema,
  pipelineSchemaKeys,
  onTogglePipelineSchema,
  onSelect,
  total,
  refreshKey = 0,
  showTestSources = false,
}: ScannedFacetTreeProps) {
  const [catalogs, setCatalogs] = useState<TreeCatalog[]>([]);
  const [schemas, setSchemas] = useState<FacetSchema[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFacets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (!showTestSources) params.append('excludeTestSources', 'true');
      const res = await fetch(`/api/agent-lab/context/objects/scanned/facets?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setCatalogs(data.catalogs ?? []);
      setSchemas(data.schemas ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [showTestSources]);

  useEffect(() => { void fetchFacets(); }, [fetchFacets, refreshKey]);

  const treeSchemas = useMemo<TreeSchema[]>(
    () => schemas.map((s) => ({ catalog: s.catalog, name: s.name, count: s.count, hint: schemaHint(s) })),
    [schemas],
  );

  const checkedCount = pipelineSchemaKeys?.size ?? 0;

  return (
    <FacetTreeView
      title="Catalogs"
      allLabel="All catalogs"
      total={total}
      catalogs={catalogs}
      schemas={treeSchemas}
      loading={loading}
      selectedCatalog={selectedCatalog}
      selectedSchema={selectedSchema}
      onSelect={onSelect}
      schemaCheck={
        onTogglePipelineSchema
          ? {
              isChecked: (key) => pipelineSchemaKeys?.has(key) ?? false,
              toggle: onTogglePipelineSchema,
              label: 'Include in Continue pipeline',
            }
          : undefined
      }
      footnote={
        onTogglePipelineSchema
          ? checkedCount > 0
            ? `${checkedCount} schema${checkedCount === 1 ? '' : 's'} ticked for Continue pipeline.`
            : 'Tick schemas to continue the pipeline for several at once.'
          : undefined
      }
    />
  );
}