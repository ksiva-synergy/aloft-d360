/**
 * Client-side state for the Metrics catalog surface (the layered catalog that
 * replaces the flat governance queue). Mirrors the builder-store pattern:
 * `create()(immer(...))`, one flat interface (state, then `// Actions`), no
 * persist. Only SHARED derived data (filtered/sorted rows, coverage rollup,
 * facet counts) is computed here as pure selectors; row-local transforms stay
 * in components.
 *
 * Selection is a `Record<rowKey, true>` (not a Set) so immer drafts it without
 * needing enableMapSet().
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { IntentDisambiguation } from '@/lib/dashboards/guided-types';
import {
  type CatalogRow,
  type CatalogSession,
  type CoverageMode,
  type DefKind,
  type GovStatus,
  type Lens,
  type SortCol,
  type SortState,
} from './catalog-types';
import { themeOrder, UNCATEGORIZED } from './catalog-themes';

/** Personal-layer facets — driven by fields already on the row (no extra fetch). */
export type LayerFacet = 'my_drafts' | 'authored';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface SearchState {
  raw: string;
  resolving: boolean;
  resolveError: string | null;
  /** Whether the active model is governed (resolve-intent requires it). */
  modelGoverned: boolean;
  resolvedTerms: IntentDisambiguation[];
  /** Def ids a resolved chip narrowed the table to (search→list wiring). */
  activeDefIds: string[];
}

export interface FacetState {
  status: GovStatus[];
  type: DefKind[];
  theme: string[];
  source: string[];
  layer: LayerFacet[];
}

/** Governed-share below which a theme is flagged a coverage "gap". */
export const GAP_THRESHOLD = 0.5;

export interface CoverageBucket {
  theme: string;
  total: number;
  governed: number;
  candidate: number;
  draft: number;
  govPct: number; // 0..1 over (governed+candidate+draft)
  gap: boolean;
}

interface CatalogState {
  // ── session + data ────────────────────────────────────────────────────────
  session: CatalogSession | null;
  activeModelId: string | null;
  /** Whether the active model's status is 'governed' (drives rich-surface gating). */
  activeModelGoverned: boolean;
  rows: CatalogRow[];
  loading: boolean;
  error: string | null;

  // ── view state ──────────────────────────────────────────────────────────
  lens: Lens;
  search: SearchState;
  facets: FacetState;
  gapsOnly: boolean;
  coverageMode: CoverageMode;
  sort: SortState;
  selection: Record<string, true>;
  drawerOpen: string | null; // rowKey
  toast: Toast | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  setSession: (s: CatalogSession) => void;
  setActiveModel: (modelId: string | null, governed: boolean) => void;
  setRows: (rows: CatalogRow[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;

  setLens: (l: Lens) => void;

  setSearchRaw: (raw: string) => void;
  setResolving: (v: boolean) => void;
  setResolved: (terms: IntentDisambiguation[], modelGoverned: boolean) => void;
  setResolveError: (e: string | null) => void;
  chooseAmbiguous: (term: string, chosenId: string) => void;
  /** Narrow the table to a resolved def (chip click). Empty clears the narrow. */
  setActiveDefIds: (ids: string[]) => void;
  clearSearch: () => void;

  toggleFacet: <K extends keyof FacetState>(group: K, value: FacetState[K][number]) => void;
  setThemeFacet: (theme: string) => void; // coverage theme-click (replaces theme facet)
  clearFacets: () => void;
  setGapsOnly: (v: boolean) => void;

  setCoverageMode: (m: CoverageMode) => void;
  setSort: (col: SortCol) => void;

  toggleSelect: (rowKey: string) => void;
  selectMany: (rowKeys: string[]) => void;
  clearSelection: () => void;

  openDrawer: (rowKey: string) => void;
  closeDrawer: () => void;

  showToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: () => void;

  /** Optimistic status flip on acted rows post-mutation (before refetch reconcile). */
  optimisticStatus: (rowKeys: string[], status: GovStatus) => void;

  /** Expanded similarity-cluster parent rows (keyed by clusterId). */
  expandedClusters: Record<string, true>;
  toggleCluster: (clusterId: string) => void;
}

const EMPTY_SEARCH: SearchState = {
  raw: '',
  resolving: false,
  resolveError: null,
  modelGoverned: false,
  resolvedTerms: [],
  activeDefIds: [],
};

const EMPTY_FACETS: FacetState = { status: [], type: [], theme: [], source: [], layer: [] };

let toastSeq = 0;

export const useCatalogStore = create<CatalogState>()(
  immer((set) => ({
    session: null,
    activeModelId: null,
    activeModelGoverned: false,
    rows: [],
    loading: true,
    error: null,

    lens: 'govern',
    search: { ...EMPTY_SEARCH },
    facets: { ...EMPTY_FACETS },
    gapsOnly: false,
    coverageMode: 'bars',
    sort: { col: 'label', dir: 'asc' },
    selection: {},
    drawerOpen: null,
    toast: null,
    expandedClusters: {} as Record<string, true>,
    // ── session + data ──────────────────────────────────────────────────────
    setSession: (s) =>
      set((st) => {
        st.session = s;
      }),
    setActiveModel: (modelId, governed) =>
      set((st) => {
        st.activeModelId = modelId;
        st.activeModelGoverned = governed;
        // Model switch is a scope change: reset per-model view state.
        st.selection = {};
        st.drawerOpen = null;
        st.facets = { ...EMPTY_FACETS };
        st.gapsOnly = false;
        st.search = { ...EMPTY_SEARCH, modelGoverned: governed };
      }),
    setRows: (rows) =>
      set((st) => {
        st.rows = rows;
      }),
    setLoading: (v) =>
      set((st) => {
        st.loading = v;
      }),
    setError: (e) =>
      set((st) => {
        st.error = e;
      }),

    // ── lens ──────────────────────────────────────────────────────────────
    setLens: (l) =>
      set((st) => {
        st.lens = l;
      }),

    // ── search ──────────────────────────────────────────────────────────────
    setSearchRaw: (raw) =>
      set((st) => {
        st.search.raw = raw;
      }),
    setResolving: (v) =>
      set((st) => {
        st.search.resolving = v;
        if (v) st.search.resolveError = null;
      }),
    setResolved: (terms, modelGoverned) =>
      set((st) => {
        st.search.resolvedTerms = terms;
        st.search.resolving = false;
        st.search.modelGoverned = modelGoverned;
      }),
    setResolveError: (e) =>
      set((st) => {
        st.search.resolveError = e;
        st.search.resolving = false;
      }),
    chooseAmbiguous: (term, chosenId) =>
      set((st) => {
        const t = st.search.resolvedTerms.find((r) => r.term === term);
        if (t) t.chosenId = chosenId;
      }),
    setActiveDefIds: (ids) =>
      set((st) => {
        st.search.activeDefIds = ids;
      }),
    clearSearch: () =>
      set((st) => {
        st.search = { ...EMPTY_SEARCH, modelGoverned: st.activeModelGoverned };
      }),

    // ── facets ──────────────────────────────────────────────────────────────
    toggleFacet: (group, value) =>
      set((st) => {
        const arr = st.facets[group] as unknown[];
        const i = arr.indexOf(value);
        if (i === -1) arr.push(value);
        else arr.splice(i, 1);
      }),
    setThemeFacet: (theme) =>
      set((st) => {
        st.facets.theme = [theme];
      }),
    clearFacets: () =>
      set((st) => {
        st.facets = { ...EMPTY_FACETS };
        st.gapsOnly = false;
        st.search.activeDefIds = [];
      }),
    setGapsOnly: (v) =>
      set((st) => {
        st.gapsOnly = v;
      }),

    // ── coverage + sort ───────────────────────────────────────────────────
    setCoverageMode: (m) =>
      set((st) => {
        st.coverageMode = m;
      }),
    setSort: (col) =>
      set((st) => {
        if (st.sort.col === col) st.sort.dir = st.sort.dir === 'asc' ? 'desc' : 'asc';
        else st.sort = { col, dir: 'asc' };
      }),

    // ── selection ───────────────────────────────────────────────────────────
    toggleSelect: (rowKey) =>
      set((st) => {
        if (st.selection[rowKey]) delete st.selection[rowKey];
        else st.selection[rowKey] = true;
      }),
    selectMany: (rowKeys) =>
      set((st) => {
        for (const k of rowKeys) st.selection[k] = true;
      }),
    clearSelection: () =>
      set((st) => {
        st.selection = {};
      }),

    // ── drawer ──────────────────────────────────────────────────────────────
    openDrawer: (rowKey) =>
      set((st) => {
        st.drawerOpen = rowKey;
      }),
    closeDrawer: () =>
      set((st) => {
        st.drawerOpen = null;
      }),

    // ── toast ─────────────────────────────────────────────────────────────
    showToast: (kind, message) =>
      set((st) => {
        st.toast = { id: ++toastSeq, kind, message };
      }),
    dismissToast: () =>
      set((st) => {
        st.toast = null;
      }),

    // ── optimistic mutation ─────────────────────────────────────────────────
    optimisticStatus: (rowKeys, status) =>
      set((st) => {
        const keys = new Set(rowKeys);
        for (const r of st.rows) if (keys.has(r.rowKey)) r.status = status;
      }),

    // ── cluster expand/collapse ─────────────────────────────────────────────
    toggleCluster: (clusterId) =>
      set((st) => {
        if (st.expandedClusters[clusterId]) delete st.expandedClusters[clusterId];
        else st.expandedClusters[clusterId] = true;
      }),
  })),
);

// ────────────────────────────────────────────────────────────────────────────
// Pure selectors (exported so components memoize + tests exercise them directly)
// ────────────────────────────────────────────────────────────────────────────

function rowMatchesRaw(row: CatalogRow, raw: string): boolean {
  if (!raw.trim()) return true;
  const q = raw.trim().toLowerCase();
  return (
    row.label.toLowerCase().includes(q) ||
    row.fullPath.toLowerCase().includes(q) ||
    row.synonyms.some((s) => s.toLowerCase().includes(q))
  );
}

export interface SelectableState {
  rows: CatalogRow[];
  facets: FacetState;
  search: Pick<SearchState, 'raw' | 'activeDefIds'>;
  gapsOnly: boolean;
  sort: SortState;
  session: CatalogSession | null;
}

/** The gap-theme set for the current rows (themes below the governed-share bar). */
export function selectGapThemes(rows: CatalogRow[]): Set<string> {
  const gaps = new Set<string>();
  for (const b of selectCoverage(rows)) if (b.gap) gaps.add(b.theme);
  return gaps;
}

/** Facet + search + gaps filtering (no sort). Pure. */
export function selectFilteredRows(state: SelectableState): CatalogRow[] {
  const { rows, facets, search, gapsOnly, session } = state;
  const me = session?.currentUserId ?? null;
  const gapThemes = gapsOnly ? selectGapThemes(rows) : null;
  const activeDefs = search.activeDefIds.length ? new Set(search.activeDefIds) : null;

  return rows.filter((r) => {
    // Cluster parent rows are virtual — exclude from filtered count and facet matching
    if (r.isClusterParent) return false;
    if (facets.status.length && !facets.status.includes(r.status)) return false;
    if (facets.type.length && !facets.type.includes(r.kind)) return false;
    if (facets.theme.length && !facets.theme.includes(r.theme)) return false;
    if (facets.source.length && !facets.source.includes(r.fullPath)) return false;
    if (facets.layer.length) {
      const inLayer = facets.layer.some((l) =>
        l === 'my_drafts' ? r.isDraft && r.createdBy === me : r.createdBy === me,
      );
      if (!inLayer) return false;
    }
    if (activeDefs && !activeDefs.has(r.id)) return false;
    if (gapThemes && !gapThemes.has(r.theme)) return false;
    if (!rowMatchesRaw(r, search.raw)) return false;
    return true;
  });
}

const STATUS_ORDER: Record<string, number> = { governed: 0, candidate: 1, draft: 2, archived: 3 };
const KIND_ORDER: Record<DefKind, number> = { entity: 0, measure: 1, dimension: 2 };

export function sortRows(rows: CatalogRow[], sort: SortState): CatalogRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: CatalogRow, b: CatalogRow): number => {
    switch (sort.col) {
      case 'kind':
        return (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.label.localeCompare(b.label);
      case 'status':
        return ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)) || a.label.localeCompare(b.label);
      case 'theme':
        return (themeOrder(a.theme) - themeOrder(b.theme)) || a.label.localeCompare(b.label);
      case 'source':
        return a.fullPath.localeCompare(b.fullPath) || a.label.localeCompare(b.label);
      case 'composition':
        return ((a.dCount ?? -1) + (a.mCount ?? 0) - ((b.dCount ?? -1) + (b.mCount ?? 0))) || a.label.localeCompare(b.label);
      case 'updated':
        return a.updatedAt.localeCompare(b.updatedAt);
      case 'label':
      default:
        return a.label.localeCompare(b.label);
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) * dir);
}

export function selectSortedRows(state: SelectableState): CatalogRow[] {
  return sortRows(selectFilteredRows(state), state.sort);
}

/** Coverage rollup per theme. Draft segment reflects only rows visible to the
 *  viewer (others' drafts are RBAC-invisible), which is the honest scoping. */
export function selectCoverage(rows: CatalogRow[]): CoverageBucket[] {
  const byTheme = new Map<string, CoverageBucket>();
  for (const r of rows) {
    if (r.isClusterParent) continue; // synthetic rows — don't double-count
    let b = byTheme.get(r.theme);
    if (!b) {
      b = { theme: r.theme, total: 0, governed: 0, candidate: 0, draft: 0, govPct: 0, gap: false };
      byTheme.set(r.theme, b);
    }
    b.total++;
    if (r.status === 'governed') b.governed++;
    else if (r.status === 'candidate') b.candidate++;
    else if (r.status === 'draft') b.draft++;
  }
  const buckets = [...byTheme.values()];
  for (const b of buckets) {
    const denom = b.governed + b.candidate + b.draft;
    b.govPct = denom > 0 ? b.governed / denom : 0;
    b.gap = b.govPct < GAP_THRESHOLD;
  }
  return buckets.sort((a, b) => themeOrder(a.theme) - themeOrder(b.theme));
}

export interface FacetCount<T extends string = string> {
  value: T;
  count: number;
}

/** Live counts per facet option, computed over the CURRENT rows (unfiltered by
 *  that same group so counts don't collapse to what's already selected). */
export function selectFacetCounts(rows: CatalogRow[], me: string | null) {
  const status = new Map<string, number>();
  const type = new Map<string, number>();
  const theme = new Map<string, number>();
  const source = new Map<string, number>();
  let myDrafts = 0;
  let authored = 0;
  for (const r of rows) {
    if (r.isClusterParent) continue; // skip synthetic header rows
    status.set(r.status, (status.get(r.status) ?? 0) + 1);
    type.set(r.kind, (type.get(r.kind) ?? 0) + 1);
    theme.set(r.theme, (theme.get(r.theme) ?? 0) + 1);
    source.set(r.fullPath, (source.get(r.fullPath) ?? 0) + 1);
    if (me && r.createdBy === me) {
      authored++;
      if (r.isDraft) myDrafts++;
    }
  }
  const toArr = (m: Map<string, number>): FacetCount[] =>
    [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  return {
    status: toArr(status),
    type: toArr(type),
    theme: toArr(theme).sort((a, b) => themeOrder(a.value) - themeOrder(b.value)),
    source: toArr(source),
    layer: { my_drafts: myDrafts, authored } as Record<LayerFacet, number>,
  };
}

export { UNCATEGORIZED };
