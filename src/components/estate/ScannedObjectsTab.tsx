'use client';

import { Select } from '@/components/form/Select';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useRouter } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import ScannedFacetTree from './ScannedFacetTree';
import ScannedPipelineScopeBar, {
  MAX_CONTINUE_SCHEMAS,
  MAX_CONTINUE_TABLES,
} from './ScannedPipelineScopeBar';
import Pagination from './Pagination';
import { CatalogSearch } from './EstateFilterBar';
import { CATALOG_SELECT, CATALOG_SELECT_ARROW, ObjectNameCell, formatCompactCount, formatFull, formatRelative } from './catalog-ui';
import { schemaIncludePattern } from '@/lib/estate/catalog-pipeline';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';
import { ESTATE_PIPELINE_TIERS, estateTierDisplayLabel, type ScannedTierId } from '@/lib/estate/stages';

interface ScannedObjectItem {
  id: string;
  full_path: string;
  catalog_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  object_kind: string;
  row_count_est: string | null;
  last_t0_at: string | null;
  last_t1_at: string | null;
  last_t2_at: string | null;
  last_t3_at: string | null;
  last_t4_at: string | null;
  has_embedding: boolean;
  embedding_current?: boolean;
  lifecycle: string;
  source_id: string;
  source_name: string | null;
}

interface ScannedTierCounts {
  t0: number;
  t1: number;
  t2: number;
  embed: number;
  t3: number;
  t4: number;
}

interface ScannedEmbeddingTotals {
  objects_with_embedding: number;
  object_vector_rows: number;
  column_vector_rows: number;
}

type TierFilter = ScannedTierId | null;
type Tier = ScannedTierId;

interface ScannedFilterState {
  catalog?: string;
  schema?: string;
  kind?: string;
  q?: string;
  tier: TierFilter;
  needsEmbed?: boolean;
  page: number;
  pageSize: number;
}

interface ScannedObjectsTabProps {
  sourceFilter?: string;
  refreshKey?: number;
  showTestSources?: boolean;
  canRunPipeline?: boolean;
  /** Pre-select a tier filter (e.g. from a Jobs funnel stage click). */
  initialTier?: TierFilter;
  /** Open the list on tables whose embedding is missing or out of date. */
  initialNeedsEmbed?: boolean;
}

/** Pipeline steps in order. Colours match the Stage badges on "All objects". */
const TIERS = ESTATE_PIPELINE_TIERS;

function tierDone(obj: ScannedObjectItem, tier: Tier): boolean {
  switch (tier) {
    case 't0': return !!obj.last_t0_at;
    case 't1': return !!obj.last_t1_at;
    case 't2': return !!obj.last_t2_at;
    case 'embed': return obj.embedding_current ?? obj.has_embedding;
    case 't3': return !!obj.last_t3_at;
    case 't4': return !!obj.last_t4_at;
  }
}

/** First missing core step (structure → profile → description → search). */
function nextStep(obj: ScannedObjectItem): string | null {
  if (!obj.last_t1_at) return 'Needs profile';
  if (!obj.last_t2_at) return 'Needs description';
  if (!(obj.embedding_current ?? obj.has_embedding)) return 'Needs searchable';
  return null;
}

function PipelineProgress({ obj }: { obj: ScannedObjectItem }) {
  const next = nextStep(obj);
  const tip = TIERS.map((t) => `${tierDone(obj, t.id) ? '\u2713' : '\u00b7'} ${estateTierDisplayLabel(t)} (${t.code})`).join('\n');
  return (
    <span className="flex items-center gap-2.5" title={tip}>
      <span className="flex shrink-0 gap-[3px]" aria-label={`Pipeline: ${TIERS.filter((t) => tierDone(obj, t.id)).map((t) => estateTierDisplayLabel(t)).join(', ') || 'nothing yet'}`}>
        {TIERS.map((t) => (
          <span
            key={t.id}
            className="h-1.5 w-3.5 rounded-full"
            style={{ background: tierDone(obj, t.id) ? t.color : 'color-mix(in srgb, var(--estate-text-dim) 22%, transparent)' }}
          />
        ))}
      </span>
      <span className={cn('truncate text-caption', next ? 'text-[var(--estate-text-muted)]' : 'text-[var(--ok)]')}>
        {next ?? 'Ready'}
      </span>
    </span>
  );
}

function TierPill({ tier, count, active, onClick }: { tier: (typeof TIERS)[number]; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={`${estateTierDisplayLabel(tier)}: ${tier.desc}. ${active ? 'Click to clear the filter.' : 'Click to show only these.'}`}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-label transition-colors duration-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        active
          ? 'border-[var(--brand-a)] bg-[color:color-mix(in_srgb,var(--brand-a)_10%,transparent)] text-[var(--estate-ink)]'
          : 'border-[var(--estate-border)] text-[var(--estate-text-secondary)] hover:border-[var(--estate-btn-border)] hover:text-[var(--estate-ink)]',
      )}
    >
      <span className="size-1.5 rounded-full" style={{ background: count > 0 ? tier.color : 'transparent', boxShadow: count > 0 ? undefined : `inset 0 0 0 1px ${tier.color}` }} />
      {estateTierDisplayLabel(tier)}
      <span className="tabular-nums text-[var(--estate-text-muted)]">{count.toLocaleString()}</span>
    </button>
  );
}

const TH = 'sticky top-0 z-10 border-b border-[var(--estate-border)] bg-[var(--estate-bg)] px-3 py-2.5 text-left text-caption font-medium uppercase tracking-wide text-[var(--estate-text-muted)] whitespace-nowrap';
const TD = 'border-b border-[var(--estate-border)] px-3 py-2.5';
const SKELETON = 'h-3.5 animate-pulse rounded bg-[color:color-mix(in_srgb,var(--line-2)_15%,transparent)]';
export function ScannedObjectsTab({
  sourceFilter,
  refreshKey = 0,
  showTestSources = false,
  canRunPipeline: canRunPipelineProp,
  initialTier = null,
  initialNeedsEmbed = false,
}: ScannedObjectsTabProps) {
  const canRunFromSession = useCanRunEstatePipeline();
  const canRunPipeline = canRunPipelineProp ?? canRunFromSession;
  const router = useRouter();
  const [items, setItems] = useState<ScannedObjectItem[]>([]);
  const [total, setTotal] = useState(0);
  const [tierCounts, setTierCounts] = useState<ScannedTierCounts>({ t0: 0, t1: 0, t2: 0, embed: 0, t3: 0, t4: 0 });
  const [embeddingTotals, setEmbeddingTotals] = useState<ScannedEmbeddingTotals | null>(null);
  const [needsEmbedCount, setNeedsEmbedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchVal, setSearchVal] = useState('');
  const [pipelineSchemaKeys, setPipelineSchemaKeys] = useState<Set<string>>(new Set());
  const [selectedTablePaths, setSelectedTablePaths] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState<ScannedFilterState>({
    catalog: undefined,
    schema: undefined,
    kind: undefined,
    q: undefined,
    tier: initialNeedsEmbed ? null : initialTier,
    needsEmbed: initialNeedsEmbed || undefined,
    page: 1,
    pageSize: 50,
  });

  const pipelineIncludePatterns = useMemo(() => {
    if (selectedTablePaths.size > 0) return [...selectedTablePaths];
    if (pipelineSchemaKeys.size > 0) {
      return [...pipelineSchemaKeys].map(key => {
        const dot = key.indexOf('.');
        if (dot <= 0) return key;
        return schemaIncludePattern(key.slice(0, dot), key.slice(dot + 1));
      });
    }
    if (filters.catalog && filters.schema) {
      return [schemaIncludePattern(filters.catalog, filters.schema)];
    }
    if (filters.catalog) return [`${filters.catalog}.*`];
    return [];
  }, [pipelineSchemaKeys, selectedTablePaths, filters.catalog, filters.schema]);

  const pipelineScopeLabel = useMemo(() => {
    if (selectedTablePaths.size > 0) return `${selectedTablePaths.size} table(s)`;
    if (pipelineSchemaKeys.size > 0) return `${pipelineSchemaKeys.size} schema(s)`;
    if (filters.catalog && filters.schema) return `${filters.catalog}.${filters.schema}`;
    if (filters.catalog) return filters.catalog;
    return undefined;
  }, [selectedTablePaths, pipelineSchemaKeys, filters.catalog, filters.schema]);

  const pipelineCatalog = useMemo(() => {
    if (pipelineSchemaKeys.size > 0) {
      const first = [...pipelineSchemaKeys][0];
      return first?.split('.')[0];
    }
    return filters.catalog;
  }, [pipelineSchemaKeys, filters.catalog]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      if (filters.q !== (searchVal || undefined)) {
        setFilters(prev => ({ ...prev, q: searchVal || undefined, page: 1 }));
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [searchVal, filters.q]);

  const fetchObjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sourceFilter && sourceFilter !== 'All') params.append('sourceId', sourceFilter);
      if (filters.kind) params.append('kind', filters.kind);
      if (filters.tier) params.append('tier', filters.tier);
      if (filters.needsEmbed) params.append('needsEmbed', 'true');
      if (filters.catalog) params.append('catalog', filters.catalog);
      if (filters.schema) params.append('schema', filters.schema);
      if (filters.q) params.append('q', filters.q);
      if (!showTestSources) params.append('excludeTestSources', 'true');
      params.append('page', String(filters.page));
      params.append('pageSize', String(filters.pageSize));

      const res = await fetch(`/api/agent-lab/context/objects/scanned?${params}`);
      if (res.ok) {
        const json = await res.json();
        const newItems = json?.data?.items ?? [];
        const newTotal = json?.data?.total ?? 0;
        const newTierCounts = json?.data?.tierCounts ?? { t0: 0, t1: 0, t2: 0, embed: 0, t3: 0, t4: 0 };
        setItems(newItems);
        setTotal(newTotal);
        setTierCounts(newTierCounts);
        setEmbeddingTotals(json?.data?.embeddingTotals ?? null);
        setNeedsEmbedCount(json?.data?.needsEmbed ?? 0);
      } else {
        setItems([]);
        setTotal(0);
        setTierCounts({ t0: 0, t1: 0, t2: 0, embed: 0, t3: 0, t4: 0 });
        setEmbeddingTotals(null);
        setNeedsEmbedCount(0);
      }
    } catch (err) {
      console.error('[ScannedObjectsTab] fetch error', err);
      setItems([]);
      setTotal(0);
      setTierCounts({ t0: 0, t1: 0, t2: 0, embed: 0, t3: 0, t4: 0 });
      setEmbeddingTotals(null);
      setNeedsEmbedCount(0);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, filters, refreshKey, showTestSources]);

  useEffect(() => {
    fetchObjects();
  }, [fetchObjects]);

  const handleFacetSelect = useCallback((catalog?: string, schema?: string) => {
    setFilters(prev => ({ ...prev, catalog, schema, page: 1 }));
  }, []);

  const handleTogglePipelineSchema = useCallback((catalog: string, schema: string) => {
    const key = `${catalog}.${schema}`;
    setSelectedTablePaths(new Set());
    setPipelineSchemaKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        if (next.size >= MAX_CONTINUE_SCHEMAS) return prev;
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleTablePath = useCallback((fullPath: string) => {
    setPipelineSchemaKeys(new Set());
    setSelectedTablePaths(prev => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else {
        if (next.size >= MAX_CONTINUE_TABLES) return prev;
        next.add(fullPath);
      }
      return next;
    });
  }, []);

  const handleFilterChange = useCallback((updates: Partial<ScannedFilterState>) => {
    setFilters(prev => ({ ...prev, ...updates, page: 1 }));
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }));
  }, []);

  const handleTierClick = useCallback((tier: Tier) => {
    setFilters(prev => ({ ...prev, tier: prev.tier === tier ? null : tier, needsEmbed: undefined, page: 1 }));
  }, []);

  const handleNeedsEmbedClick = useCallback(() => {
    setFilters(prev => ({ ...prev, needsEmbed: prev.needsEmbed ? undefined : true, tier: null, page: 1 }));
  }, []);

  const multiSource = useMemo(() => new Set(items.map(i => i.source_id)).size > 1, [items]);
  const colCount = 5 + (canRunPipeline ? 1 : 0) + (multiSource ? 1 : 0);
  const activeTier = TIERS.find(t => t.id === filters.tier);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ScannedFacetTree
        selectedCatalog={filters.catalog}
        selectedSchema={filters.schema}
        pipelineSchemaKeys={canRunPipeline ? pipelineSchemaKeys : undefined}
        onTogglePipelineSchema={canRunPipeline ? handleTogglePipelineSchema : undefined}
        onSelect={handleFacetSelect}
        total={total}
        refreshKey={refreshKey}
        showTestSources={showTestSources}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-6 py-3">
          <CatalogSearch
            value={searchVal}
            onChange={setSearchVal}
            placeholder={`Search ${total.toLocaleString()} scanned objects\u2026`}
          />
          <Select
            aria-label="Object type"
            className={CATALOG_SELECT}
            style={CATALOG_SELECT_ARROW}
            value={filters.kind || ''}
            onChange={e => handleFilterChange({ kind: e.target.value || undefined })}
          >
            <option value="">Any type</option>
            <option value="table">Table</option>
            <option value="view">View</option>
            <option value="materialized_view">Materialized view</option>
          </Select>
        </div>

        {(pipelineIncludePatterns.length > 0 || filters.catalog) && (
          <ScannedPipelineScopeBar
            canRunPipeline={canRunPipeline}
            catalog={pipelineCatalog}
            schema={pipelineSchemaKeys.size > 0 || selectedTablePaths.size > 0 ? undefined : filters.schema}
            includePatterns={
              pipelineSchemaKeys.size > 0 || selectedTablePaths.size > 0 ? pipelineIncludePatterns : undefined
            }
            scopeLabel={pipelineScopeLabel}
            sourceId={sourceFilter && sourceFilter !== 'All' ? sourceFilter : undefined}
            onLaunched={() => {
              fetchObjects();
              setPipelineSchemaKeys(new Set());
              setSelectedTablePaths(new Set());
            }}
            onShowNeedsEmbed={handleNeedsEmbedClick}
          />
        )}

        {/* Pipeline step filter: each pill counts objects that completed that step */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-3">
          <span className="text-ui-regular text-[var(--estate-text-muted)]">
            {loading && total === 0 ? '\u2014' : (
              <>
                <span className="text-[var(--estate-ink)]">{total.toLocaleString()}</span> scanned object{total !== 1 ? 's' : ''}
                {filters.needsEmbed && <> that <span className="text-[var(--estate-ink)]">need searchable</span></>}
                {activeTier && <> with <span className="text-[var(--estate-ink)]">{estateTierDisplayLabel(activeTier)}</span> done</>}
              </>
            )}
            {embeddingTotals && embeddingTotals.column_vector_rows > 0 && (
              <span
                className="ml-2 text-caption"
                title={`${embeddingTotals.objects_with_embedding.toLocaleString()} table vectors \u00b7 ${embeddingTotals.column_vector_rows.toLocaleString()} column vectors`}
              >
                {'\u00b7'} {embeddingTotals.column_vector_rows.toLocaleString()} columns searchable
              </span>
            )}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by completed step">
            {TIERS.map(t => (
              <TierPill key={t.id} tier={t} count={tierCounts[t.id]} active={filters.tier === t.id} onClick={() => handleTierClick(t.id)} />
            ))}
            {(needsEmbedCount > 0 || filters.needsEmbed) && (
              <button
                type="button"
                aria-pressed={Boolean(filters.needsEmbed)}
                title="Tables with no embedding, or an embedding older than the latest description. The Searchable color counts only embeddings that are still current, so this number plus that color is the full scanned set."
                onClick={handleNeedsEmbedClick}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-label transition-colors duration-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                  filters.needsEmbed
                    ? 'border-[var(--brand-a)] bg-[color:color-mix(in_srgb,var(--brand-a)_10%,transparent)] text-[var(--estate-ink)]'
                    : 'border-[var(--estate-border)] text-[var(--estate-text-secondary)] hover:border-[var(--estate-btn-border)] hover:text-[var(--estate-ink)]',
                )}
              >
                <span className="size-1.5 rounded-full" style={{ background: TIERS.find(t => t.id === 'embed')!.color }} />
                {needsEmbedCount.toLocaleString()} need{needsEmbedCount === 1 ? 's' : ''} searchable
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              {canRunPipeline && <col className="w-10" />}
              <col />
              <col className="w-64" />
              {multiSource && <col className="w-36" />}
              <col className="w-20" />
              <col className="w-28" />
              <col className="w-10" />
            </colgroup>
            <thead>
              <tr>
                {canRunPipeline && <th className={cn(TH, 'pl-3.5')}><span className="sr-only">Select</span></th>}
                <th className={TH}>Object</th>
                <th className={TH}>Pipeline</th>
                {multiSource && <th className={TH}>Source</th>}
                <th className={cn(TH, 'text-right')}>Rows</th>
                <th className={TH}>Last scanned</th>
                <th className={TH}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                [...Array(8)].map((_, idx) => (
                  <tr key={idx}>
                    {canRunPipeline && <td className={cn(TD, 'pl-3.5')}><div className={cn(SKELETON, 'w-3.5')} /></td>}
                    <td className={TD}><div className={cn(SKELETON, 'w-3/5')} /></td>
                    <td className={TD}><div className={cn(SKELETON, 'w-32')} /></td>
                    {multiSource && <td className={TD}><div className={cn(SKELETON, 'w-20')} /></td>}
                    <td className={TD}><div className={cn(SKELETON, 'ml-auto w-10')} /></td>
                    <td className={TD}><div className={cn(SKELETON, 'w-14')} /></td>
                    <td className={TD} />
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="py-16 text-center">
                    <p className="text-ui text-[var(--estate-text-secondary)]">
                      {filters.q || filters.tier || filters.kind ? 'No scanned objects match' : 'Nothing scanned yet'}
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-caption text-[var(--estate-text-muted)]">
                      {filters.q
                        ? `Nothing matches \u201c${filters.q}\u201d.`
                        : activeTier
                          ? `No objects have reached \u201c${estateTierDisplayLabel(activeTier)}\u201d. Click the pill again to clear the filter.`
                          : filters.kind
                            ? `No ${filters.kind.replace('_', ' ')}s have been scanned yet.`
                            : 'Run a structural scan from All objects or Jobs to read columns from your sources.'}
                    </p>
                  </td>
                </tr>
              ) : items.map(obj => {
                const checked = selectedTablePaths.has(obj.full_path);
                return (
                  <tr
                    key={obj.id}
                    onClick={() => router.push(`/agent-lab/estate/object/${obj.id}`)}
                    className={cn(
                      'group cursor-pointer transition-colors duration-100 hover:bg-[var(--estate-hover)]',
                      checked && 'bg-[color:color-mix(in_srgb,var(--brand-a)_6%,transparent)]',
                    )}
                  >
                    {canRunPipeline && (
                      <td className={cn(TD, 'pl-3.5')} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTablePath(obj.full_path)}
                          title="Include in Continue pipeline"
                          aria-label={`Include ${obj.full_path} in Continue pipeline`}
                          className="size-3.5 cursor-pointer align-middle accent-[var(--brand-a)]"
                        />
                      </td>
                    )}
                    <td className={TD}><ObjectNameCell path={obj.full_path} kind={obj.object_kind} /></td>
                    <td className={TD}><PipelineProgress obj={obj} /></td>
                    {multiSource && (
                      <td className={cn(TD, 'truncate text-ui-regular text-[var(--estate-text-secondary)]')} title={obj.source_name ?? undefined}>
                        {obj.source_name ?? '\u2014'}
                      </td>
                    )}
                    <td
                      className={cn(TD, 'text-right font-mono text-ui-regular tabular-nums text-[var(--estate-text-secondary)]')}
                      title={obj.row_count_est != null ? `${Number(obj.row_count_est).toLocaleString()} rows (estimate)` : undefined}
                    >
                      {formatCompactCount(obj.row_count_est) ?? '\u2014'}
                    </td>
                    <td className={cn(TD, 'text-ui-regular text-[var(--estate-text-muted)]')} title={formatFull(obj.last_t0_at)}>
                      {formatRelative(obj.last_t0_at)}
                    </td>
                    <td className={cn(TD, 'text-right')}>
                      <ChevronRight aria-hidden className="ml-auto size-4 text-[var(--estate-text-dim)] transition-transform duration-hover group-hover:translate-x-0.5 group-hover:text-[var(--estate-ink)]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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