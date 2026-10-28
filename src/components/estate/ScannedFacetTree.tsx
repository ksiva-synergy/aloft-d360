'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { type } from '@/lib/typography/tokens';

interface FacetCatalog {
  name: string;
  count: number;
}

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
  const [catalogs, setCatalogs] = useState<FacetCatalog[]>([]);
  const [schemas, setSchemas] = useState<FacetSchema[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

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

  // Auto-expand on initial external selection (e.g. URL-driven)
  const [autoExpandedFor, setAutoExpandedFor] = useState<string | null>(null);
  useEffect(() => {
    if (selectedCatalog && selectedCatalog !== autoExpandedFor) {
      setExpanded(prev => new Set([...prev, selectedCatalog]));
      setAutoExpandedFor(selectedCatalog);
    }
  }, [selectedCatalog, autoExpandedFor]);

  const borderColor = 'var(--estate-border)';
  const surfaceBg = 'var(--estate-hover)';
  const inkColor = 'var(--estate-ink)';
  const textSecondary = 'var(--estate-text-secondary)';
  const textMuted = 'var(--estate-text-muted)';
  const textDim = 'var(--estate-text-dim)';
  const goldColor = 'var(--brand-a)';
  const activeBg = 'var(--estate-active-bg)';
  const hoverBg = 'var(--estate-hover)';

  const toggleExpand = (cat: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const visibleCatalogs = showAll ? catalogs : catalogs.slice(0, 9);
  const remainingCount = catalogs.length - 9;

  return (
    <div
      className="w-64 shrink-0 border-r overflow-y-auto h-full"
      style={{ borderColor, background: surfaceBg }}
    >
      <div className="pt-4 pb-3">
        {/* Header */}
        <div
          className="flex justify-between px-5 pb-3"
          style={{ ...type.label, }}
        >
          <span>Databases</span>
          <span>{catalogs.length}</span>
        </div>
        {onTogglePipelineSchema && (
          <p className="px-5 pb-2 text-[10px] font-mono" style={{ color: textDim }}>
            Check schemas for multi-schema Continue
          </p>
        )}

        {/* All databases */}
        <button
          type="button"
          onClick={() => onSelect(undefined, undefined)}
          className="w-full flex items-center gap-2 px-5 py-1.5 text-left transition-colors"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--type-ui-regular-size)',
            color: !selectedCatalog ? goldColor : textSecondary,
            backgroundColor: !selectedCatalog ? activeBg : 'transparent',
          }}
        >
          <span style={{ color: textDim, fontSize: 'var(--type-ui-regular-size)', width: 8 }}>▾</span>
          <span className="flex-1">All databases</span>
          <span style={{ fontSize: 'var(--type-ui-regular-size)', color: textDim, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
        </button>

        {loading ? (
          <div className="space-y-1 mt-2 px-5">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-5 bg-[color:color-mix(in_srgb,var(--line-2)_10%,transparent)] rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="mt-0.5">
            {visibleCatalogs.map(cat => {
              const isExpanded = expanded.has(cat.name);
              const isActive = selectedCatalog === cat.name && !selectedSchema;
              const catSchemas = schemas.filter(s => s.catalog === cat.name);

              return (
                <div key={cat.name}>
                  <div
                    className="flex items-center gap-2 px-5 py-[7px] cursor-pointer transition-colors"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--type-ui-regular-size)',
                      color: isActive ? goldColor : textSecondary,
                      backgroundColor: isActive ? activeBg : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = hoverBg; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = isActive ? activeBg : 'transparent'; }}
                    onClick={() => {
                      toggleExpand(cat.name);
                      onSelect(cat.name, undefined);
                    }}
                  >
                    <span
                      style={{ color: textDim, fontSize: 'var(--type-ui-regular-size)', width: 8, cursor: 'pointer', transition: 'transform 150ms ease' }}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </span>
                    <span
                      className="flex-1 truncate"
                      title={cat.name}
                    >
                      {cat.name}
                    </span>
                    <span style={{ fontSize: 'var(--type-ui-regular-size)', color: textDim, fontVariantNumeric: 'tabular-nums' }}>
                      {cat.count}
                    </span>
                  </div>

                  {isExpanded && catSchemas.length > 0 && (
                    <div className="pl-9">
                      {catSchemas.map(sch => {
                        const schActive = selectedCatalog === cat.name && selectedSchema === sch.name;
                        const pipeKey = `${cat.name}.${sch.name}`;
                        const pipeChecked = pipelineSchemaKeys?.has(pipeKey) ?? false;
                        return (
                          <div
                            key={sch.name}
                            className="flex items-center gap-1 px-1 py-[3px]"
                          >
                            {onTogglePipelineSchema && (
                              <input
                                type="checkbox"
                                checked={pipeChecked}
                                onChange={() => onTogglePipelineSchema(cat.name, sch.name)}
                                onClick={e => e.stopPropagation()}
                                className="shrink-0 cursor-pointer"
                                title="Include in Continue pipeline"
                              />
                            )}
                            <button
                            type="button"
                            onClick={() => onSelect(cat.name, sch.name)}
                            className="flex-1 flex items-center gap-2 text-left px-2 py-[5px] truncate transition-colors"
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--type-ui-regular-size)',
                              color: schActive ? goldColor : textMuted,
                              backgroundColor: schActive ? activeBg : 'transparent',
                            }}
                            onMouseEnter={e => { if (!schActive) e.currentTarget.style.backgroundColor = hoverBg; }}
                            onMouseLeave={e => { if (!schActive) e.currentTarget.style.backgroundColor = schActive ? activeBg : 'transparent'; }}
                            title={
                              sch.needs_profile || sch.needs_enrich || sch.needs_embed
                                ? `${sch.name} — ${sch.needs_profile ?? 0} need profile, ${sch.needs_enrich ?? 0} enrich, ${sch.needs_embed ?? 0} embed`
                                : sch.name
                            }
                          >
                            <span className="truncate flex-1">{sch.name}</span>
                            <span style={{ fontSize: 'var(--type-ui-regular-size)', color: textDim }}>
                              {sch.count}
                              {(sch.needs_profile ?? 0) > 0 && (
                                <span style={{ color: '#86EFAC', marginLeft: 4 }}>+{sch.needs_profile}</span>
                              )}
                            </span>
                          </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {!showAll && remainingCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full text-left px-5 py-2 transition-colors"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--type-ui-regular-size)',
                  color: textDim,
                  letterSpacing: '0.04em',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = goldColor; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--estate-text-dim)'; }}
              >
                + {remainingCount} more databases…
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
