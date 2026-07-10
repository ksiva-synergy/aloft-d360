'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface FacetCatalog {
  name: string;
  count: number;
}

interface FacetSchema {
  catalog: string;
  name: string;
  count: number;
}

interface ScannedFacetTreeProps {
  selectedCatalog?: string;
  selectedSchema?: string;
  onSelect: (catalog?: string, schema?: string) => void;
  total: number;
  refreshKey?: number;
  showTestSources?: boolean;
}

export default function ScannedFacetTree({ selectedCatalog, selectedSchema, onSelect, total, refreshKey = 0, showTestSources = false }: ScannedFacetTreeProps) {
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
  const goldColor = '#FDB515';
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
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '9.5px', letterSpacing: '0.16em', color: textDim, textTransform: 'uppercase' }}
        >
          <span>Databases</span>
          <span>{catalogs.length}</span>
        </div>

        {/* All databases */}
        <button
          type="button"
          onClick={() => onSelect(undefined, undefined)}
          className="w-full flex items-center gap-2 px-5 py-1.5 text-left transition-colors"
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '11.5px',
            color: !selectedCatalog ? goldColor : textSecondary,
            backgroundColor: !selectedCatalog ? activeBg : 'transparent',
          }}
        >
          <span style={{ color: textDim, fontSize: '9px', width: 8 }}>▾</span>
          <span className="flex-1">All databases</span>
          <span style={{ fontSize: '9.5px', color: textDim, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
        </button>

        {loading ? (
          <div className="space-y-1 mt-2 px-5">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-5 bg-slate-400/10 rounded animate-pulse" />
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
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11.5px',
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
                      style={{ color: textDim, fontSize: '9px', width: 8, cursor: 'pointer', transition: 'transform 150ms ease' }}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </span>
                    <span
                      className="flex-1 truncate"
                      title={cat.name}
                    >
                      {cat.name}
                    </span>
                    <span style={{ fontSize: '9.5px', color: textDim, fontVariantNumeric: 'tabular-nums' }}>
                      {cat.count}
                    </span>
                  </div>

                  {isExpanded && catSchemas.length > 0 && (
                    <div className="pl-9">
                      {catSchemas.map(sch => {
                        const schActive = selectedCatalog === cat.name && selectedSchema === sch.name;
                        return (
                          <button
                            key={sch.name}
                            type="button"
                            onClick={() => onSelect(cat.name, sch.name)}
                            className="w-full flex items-center gap-2 text-left px-3 py-[5px] truncate transition-colors"
                            style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: '10.5px',
                              color: schActive ? goldColor : textMuted,
                              backgroundColor: schActive ? activeBg : 'transparent',
                            }}
                            onMouseEnter={e => { if (!schActive) e.currentTarget.style.backgroundColor = hoverBg; }}
                            onMouseLeave={e => { if (!schActive) e.currentTarget.style.backgroundColor = schActive ? activeBg : 'transparent'; }}
                            title={sch.name}
                          >
                            <span className="truncate flex-1">{sch.name}</span>
                            <span style={{ fontSize: '9px', color: textDim }}>{sch.count}</span>
                          </button>
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
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '10px',
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
