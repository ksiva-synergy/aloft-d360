'use client';

import React, { useState, useEffect } from 'react';
import { FilterState } from './FilterBar';

interface Source {
  id: string;
  display_name: string | null;
  connection_kind: string;
  connection_ref: string;
  scope_include: any;
  status: string;
}

interface TreeSchema {
  name: string;
  count: number | 'loading' | null;
}

interface TreeCatalog {
  name: string;
  count: number | 'loading' | null;
  schemas: Record<string, TreeSchema>;
  expanded: boolean;
}

interface SourceNode {
  source: Source;
  count: number | 'loading' | null;
  catalogs: Record<string, TreeCatalog>;
  expanded: boolean;
}

interface CatalogTreeProps {
  filters: FilterState;
  onChange: (updates: Partial<FilterState>) => void;
}

export default function CatalogTree({ filters, onChange }: CatalogTreeProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [treeNodes, setTreeNodes] = useState<Record<string, SourceNode>>({});

  // 1. Load sources on mount
  useEffect(() => {
    async function loadSources() {
      try {
        const res = await fetch('/api/agent-lab/context/sources');
        if (res.ok) {
          const json = await res.json();
          setSources(json.sources || []);
          
          // Initialise nodes
          const initialNodes: Record<string, SourceNode> = {};
          for (const s of json.sources || []) {
            initialNodes[s.id] = {
              source: s,
              count: null,
              catalogs: {},
              expanded: false,
            };
          }
          setTreeNodes(initialNodes);
        }
      } catch (err) {
        console.error('Error fetching tree sources:', err);
      }
    }
    void loadSources();
  }, []);

  // 2. Fetch source count and extract catalogs on expand
  const expandSource = async (sourceId: string) => {
    const node = treeNodes[sourceId];
    if (!node) return;

    // Toggle expand
    const isExpanding = !node.expanded;
    setTreeNodes((prev) => ({
      ...prev,
      [sourceId]: { ...prev[sourceId], expanded: isExpanding },
    }));

    if (!isExpanding) return;

    // If already loaded counts, skip fetch
    if (node.count !== null) return;

    // Set loading
    setTreeNodes((prev) => ({
      ...prev,
      [sourceId]: { ...prev[sourceId], count: 'loading' },
    }));

    try {
      // Parallel fetches: count-only call + objects list to extract structure
      const [countRes, objectsRes] = await Promise.all([
        fetch(`/api/agent-lab/context/objects?sourceId=${sourceId}&pageSize=1`),
        fetch(`/api/agent-lab/context/objects?sourceId=${sourceId}&pageSize=250`),
      ]);

      const countJson = await countRes.json();
      const totalCount = countJson.data?.total ?? 0;

      const objectsJson = await objectsRes.json();
      const items = objectsJson.data?.items || [];

      // Extract unique catalogs and schemas
      const catalogs: Record<string, TreeCatalog> = {};
      for (const item of items) {
        const catName = item.catalog_name || 'hive_metastore';
        const scheName = item.schema_name || 'default';

        if (!catalogs[catName]) {
          catalogs[catName] = {
            name: catName,
            count: null,
            schemas: {},
            expanded: false,
          };
        }

        if (!catalogs[catName].schemas[scheName]) {
          catalogs[catName].schemas[scheName] = {
            name: scheName,
            count: null,
          };
        }
      }

      setTreeNodes((prev) => ({
        ...prev,
        [sourceId]: {
          ...prev[sourceId],
          count: totalCount,
          catalogs,
        },
      }));
    } catch (err) {
      console.error(err);
      setTreeNodes((prev) => ({
        ...prev,
        [sourceId]: { ...prev[sourceId], count: 0 },
      }));
    }
  };

  // 3. Fetch catalog count and schema counts on catalog expand
  const expandCatalog = async (sourceId: string, catalogName: string) => {
    const node = treeNodes[sourceId];
    if (!node) return;
    const cat = node.catalogs[catalogName];
    if (!cat) return;

    const isExpanding = !cat.expanded;
    setTreeNodes((prev) => {
      const prevNode = prev[sourceId];
      return {
        ...prev,
        [sourceId]: {
          ...prevNode,
          catalogs: {
            ...prevNode.catalogs,
            [catalogName]: {
              ...cat,
              expanded: isExpanding,
            },
          },
        },
      };
    });

    if (!isExpanding) return;

    // Load counts if not already loaded
    if (cat.count !== null) return;

    setTreeNodes((prev) => {
      const prevNode = prev[sourceId];
      return {
        ...prev,
        [sourceId]: {
          ...prevNode,
          catalogs: {
            ...prevNode.catalogs,
            [catalogName]: {
              ...prevNode.catalogs[catalogName],
              count: 'loading',
            },
          },
        },
      };
    });

    try {
      // Fetch catalog count
      const res = await fetch(
        `/api/agent-lab/context/objects?sourceId=${sourceId}&catalog=${catalogName}&pageSize=1`
      );
      const json = await res.json();
      const catCount = json.data?.total ?? 0;

      // Update catalog count, and set all schema counts to loading to fetch them
      setTreeNodes((prev) => {
        const prevNode = prev[sourceId];
        const updatedCat = { ...prevNode.catalogs[catalogName], count: catCount };
        
        // Lazy load schema counts in parallel background
        const schemaNames = Object.keys(updatedCat.schemas);
        void Promise.all(
          schemaNames.map(async (scheName) => {
            try {
              const sRes = await fetch(
                `/api/agent-lab/context/objects?sourceId=${sourceId}&catalog=${catalogName}&schema=${scheName}&pageSize=1`
              );
              const sJson = await sRes.json();
              const schemaCount = sJson.data?.total ?? 0;
              
              setTreeNodes((p) => {
                const pNode = p[sourceId];
                if (!pNode || !pNode.catalogs[catalogName]) return p;
                return {
                  ...p,
                  [sourceId]: {
                    ...pNode,
                    catalogs: {
                      ...pNode.catalogs,
                      [catalogName]: {
                        ...pNode.catalogs[catalogName],
                        schemas: {
                          ...pNode.catalogs[catalogName].schemas,
                          [scheName]: {
                            name: scheName,
                            count: schemaCount,
                          },
                        },
                      },
                    },
                  },
                };
              });
            } catch (err) {
              console.error(err);
            }
          })
        );

        return {
          ...prev,
          [sourceId]: {
            ...prevNode,
            catalogs: {
              ...prevNode.catalogs,
              [catalogName]: updatedCat,
            },
          },
        };
      });
    } catch (err) {
      console.error(err);
    }
  };

  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const borderColor = 'var(--estate-border-gold)';
  const activeBgColor = 'var(--estate-active-bg)';

  return (
    <div
      className="border-r overflow-y-auto py-4 min-h-0 select-none flex flex-col gap-2 shrink-0 w-[260px] sticky top-0"
      style={{ borderColor, height: '100%' }}
    >
      <div className="px-4 pb-2 font-mono text-[9px] tracking-widest text-[#5A6A85] uppercase">
        Navigator
      </div>

      <div className="flex flex-col gap-1.5 font-sans text-[13px]">
        {sources.map((src) => {
          const node = treeNodes[src.id] || { count: null, catalogs: {}, expanded: false };
          const isSelected =
            filters.sourceId === src.id && filters.catalog === undefined && filters.schema === undefined;

          return (
            <div key={src.id} className="flex flex-col">
              {/* Source Node */}
              <div
                className="flex items-center justify-between py-1.5 px-4 cursor-pointer transition-all duration-150 border-l-[3px] border-l-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                style={{
                  backgroundColor: isSelected ? activeBgColor : 'transparent',
                  borderLeftColor: isSelected ? '#FDB515' : 'transparent',
                }}
                onClick={() => {
                  onChange({ sourceId: src.id, catalog: undefined, schema: undefined });
                  void expandSource(src.id);
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="font-bold text-[#FDB515] text-[10px] w-3 flex justify-center transform transition-transform duration-200"
                    style={{ transform: node.expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  >
                    &rsaquo;
                  </span>
                  <span className="truncate font-medium" style={{ color: inkColor }}>
                    {src.display_name || 'Unnamed Source'}
                  </span>
                </div>
                <span className="font-mono text-[11px]" style={{ color: mutedColor }}>
                  {node.count === 'loading' ? '...' : node.count !== null ? node.count : ''}
                </span>
              </div>

              {/* Catalogs Section */}
              {node.expanded && (
                <div className="flex flex-col mt-0.5">
                  {Object.values(node.catalogs).map((cat) => {
                    const isCatSelected =
                      filters.sourceId === src.id &&
                      filters.catalog === cat.name &&
                      filters.schema === undefined;

                    return (
                      <div key={cat.name} className="flex flex-col">
                        <div
                          className="flex items-center justify-between py-1.5 pl-8 pr-4 cursor-pointer transition-all duration-150 border-l-[3px] border-l-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                          style={{
                            backgroundColor: isCatSelected ? activeBgColor : 'transparent',
                            borderLeftColor: isCatSelected ? '#FDB515' : 'transparent',
                          }}
                          onClick={() => {
                            onChange({ sourceId: src.id, catalog: cat.name, schema: undefined });
                            void expandCatalog(src.id, cat.name);
                          }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="font-bold text-[#FDB515] text-[10px] w-3 flex justify-center transform transition-transform duration-200"
                              style={{ transform: cat.expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                            >
                              &rsaquo;
                            </span>
                            <span className="truncate font-mono text-xs" style={{ color: labelColor }}>
                              {cat.name}
                            </span>
                          </div>
                          <span className="font-mono text-[11px]" style={{ color: mutedColor }}>
                            {cat.count === 'loading' ? '...' : cat.count !== null ? cat.count : ''}
                          </span>
                        </div>

                        {/* Schemas Section */}
                        {cat.expanded && (
                          <div className="flex flex-col mt-0.5">
                            {Object.values(cat.schemas).map((sche) => {
                              const isScheSelected =
                                filters.sourceId === src.id &&
                                filters.catalog === cat.name &&
                                filters.schema === sche.name;

                              return (
                                <div
                                  key={sche.name}
                                  className="flex items-center justify-between py-1.5 pl-12 pr-4 cursor-pointer transition-all duration-150 border-l-[3px] border-l-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                                  style={{
                                    backgroundColor: isScheSelected ? activeBgColor : 'transparent',
                                    borderLeftColor: isScheSelected ? '#FDB515' : 'transparent',
                                  }}
                                  onClick={() => {
                                    onChange({ sourceId: src.id, catalog: cat.name, schema: sche.name });
                                  }}
                                >
                                  <span className="truncate font-mono text-xs" style={{ color: labelColor }}>
                                    {sche.name}
                                  </span>
                                  <span className="font-mono text-[11px]" style={{ color: mutedColor }}>
                                    {sche.count === 'loading' ? '...' : sche.count !== null ? sche.count : ''}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
