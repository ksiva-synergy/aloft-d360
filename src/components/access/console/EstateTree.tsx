'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Database, Loader2, Search, Table2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, runAsync, type HolderType, type TreeNode, type TreeResponse } from './api';
import { Empty, NodeLabelChip } from './parts';
import s from './console.module.css';

export type TreeContext = { reload: () => Promise<void> };

type EstateTreeProps = {
  /** Annotate rows with this department's or app role's grant state (`node.holder`). */
  holder?: { type: HolderType; id: string };
  /** Annotate rows with this person's decision. */
  user?: string;
  /** Annotate rows with every department that touches them. */
  tags?: boolean;
  rightTitle: string;
  renderRight: (node: TreeNode, ctx: TreeContext) => ReactNode;
  /** Full-width content under a row (explanations, inline forms). */
  renderBelow?: (node: TreeNode, ctx: TreeContext) => ReactNode;
  refreshKey?: number;
  /** Show a checkbox on every row. */
  selected?: Set<string>;
  onToggleSelect?: (node: TreeNode, on: boolean) => void;
};

const ROOT = '';

function countText(n: TreeNode): string | null {
  if (n.depth === 1 && n.childCount !== null) {
    return `${n.childCount} schema${n.childCount === 1 ? '' : 's'} · ${n.tableCount ?? 0} tables`;
  }
  if (n.depth === 2 && n.tableCount !== null) return `${n.tableCount} table${n.tableCount === 1 ? '' : 's'}`;
  if (n.kind === 'view') return 'view';
  return null;
}

/**
 * Lazy catalog › schema › table tree. Remount it (change `key`) to switch scope.
 */
export function EstateTree({
  holder,
  user,
  tags,
  rightTitle,
  renderRight,
  renderBelow,
  refreshKey = 0,
  selected,
  onToggleSelect,
}: EstateTreeProps) {
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({});
  const [truncated, setTruncated] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ q: string; nodes: TreeNode[] } | null>(null);

  const holderType = holder?.type;
  const holderId = holder?.id;
  const scopeParams = useMemo(() => {
    const p = new URLSearchParams();
    if (holderType && holderId) p.set(holderType, holderId);
    if (user) p.set('user', user);
    if (tags) p.set('tags', '1');
    return p.toString();
  }, [holderType, holderId, user, tags]);

  const fetchLevel = useCallback(
    async (parent: string) => {
      const p = new URLSearchParams(scopeParams);
      if (parent) p.set('parent', parent);
      try {
        const data = await accessFetch<TreeResponse>(`/api/access/tree?${p}`);
        setChildren((prev) => ({ ...prev, [parent]: data.nodes }));
        setTruncated((prev) => ({ ...prev, [parent]: data.truncated }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the estate');
      }
    },
    [scopeParams],
  );

  const runSearch = useCallback(
    async (q: string) => {
      const p = new URLSearchParams(scopeParams);
      p.set('q', q);
      try {
        const data = await accessFetch<TreeResponse>(`/api/access/tree?${p}`);
        setSearch({ q, nodes: data.nodes });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
      }
    },
    [scopeParams],
  );

  const reload = useCallback(async () => {
    const term = query.trim();
    await Promise.all([
      fetchLevel(ROOT),
      ...[...expanded].map((p) => fetchLevel(p)),
      term.length >= 2 ? runSearch(term) : Promise.resolve(),
    ]);
  }, [fetchLevel, runSearch, expanded, query]);

  useEffect(() => {
    runAsync(() => fetchLevel(ROOT));
  }, [fetchLevel]);

  useEffect(() => {
    if (refreshKey > 0) runAsync(reload);
    // Only a new refreshKey should reload; reload itself changes with every expand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => void runSearch(q), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const toggle = (path: string) => {
    const opening = !expanded.has(path);
    const next = new Set(expanded);
    if (opening) next.add(path);
    else next.delete(path);
    setExpanded(next);
    if (opening && !children[path]) void fetchLevel(path);
  };

  const ctx: TreeContext = { reload };
  const q = query.trim();
  const searching = q.length >= 2;
  const results = searching && search?.q === q ? search.nodes : null;

  const renderRow = (n: TreeNode, indent: number, flat = false) => {
    const isOpen = expanded.has(n.path);
    const canExpand = !flat && n.depth < 3 && (n.childCount === null || n.childCount > 0);
    const isLoading = isOpen && !children[n.path];
    const meta = countText(n);
    const pad = 12 + (indent + 1) * 20 + 28;
    return (
      <Fragment key={n.path}>
        <div className={cn(s.treeRow, selected?.has(n.path) && s.treeRowSelected)}>
          <div className={s.treeName} style={{ paddingLeft: indent * 20 }}>
            {onToggleSelect ? (
              <input
                type="checkbox"
                className={s.treeCheck}
                checked={selected?.has(n.path) ?? false}
                onChange={(e) => onToggleSelect(n, e.target.checked)}
                aria-label={`Select ${n.path}`}
              />
            ) : null}
            <button
              type="button"
              className={s.treeToggle}
              disabled={!canExpand}
              onClick={() => toggle(n.path)}
              aria-label={isOpen ? `Collapse ${n.name}` : `Expand ${n.name}`}
              aria-expanded={canExpand ? isOpen : undefined}
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
              )}
            </button>
            {n.depth === 3 ? (
              <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <button
              type="button"
              className={cn(s.treeLabel, flat && s.mono)}
              title={n.path}
              onClick={() => (canExpand ? toggle(n.path) : undefined)}
            >
              {n.name}
            </button>
            <span className={s.treeMeta}>
              <NodeLabelChip source={n.label} />
              {meta ? <span>{meta}</span> : null}
              {!n.inEstate ? (
                <span className={s.chip} title="Known from a grant or label; not found in the harvested estate">
                  Not harvested
                </span>
              ) : null}
            </span>
          </div>
          <div className={s.treeRight}>{renderRight(n, ctx)}</div>
          {renderBelow ? renderBelow(n, ctx) : null}
        </div>
        {isOpen && children[n.path] ? (
          <>
            {children[n.path].map((c) => renderRow(c, indent + 1))}
            {children[n.path].length === 0 ? (
              <div className={s.treeNote} style={{ paddingLeft: pad }}>
                Nothing harvested here yet.
              </div>
            ) : null}
            {truncated[n.path] ? (
              <div className={s.treeNote} style={{ paddingLeft: pad }}>
                Showing the first 2,000 tables. Use search to find others.
              </div>
            ) : null}
          </>
        ) : null}
      </Fragment>
    );
  };

  const roots = children[ROOT];

  return (
    <div>
      <div className={s.treeTools}>
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className={cn(userStyles.input, '!pl-8 !pr-8')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tables by name, schema, or catalog…"
            aria-label="Search tables"
          />
          {query ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {searching && !results ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {error ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}

      <div className={s.tree}>
        <div className={s.treeHeader}>
          <span>{searching ? 'Search results' : 'Catalog › schema › table'}</span>
          <span>{rightTitle}</span>
        </div>
        {searching ? (
          !results ? (
            <div className={s.treeNote}>Searching…</div>
          ) : results.length === 0 ? (
            <div className={s.treeNote}>No harvested table matches “{q}”.</div>
          ) : (
            results.map((n) => renderRow(n, 0, true))
          )
        ) : !roots ? (
          <div className={s.treeNote}>{error ? 'Could not load catalogs.' : 'Loading catalogs…'}</div>
        ) : roots.length === 0 ? (
          <Empty>No harvested catalogs yet. Run a harvest from Estate › Jobs first.</Empty>
        ) : (
          roots.map((n) => renderRow(n, 0))
        )}
      </div>
    </div>
  );
}
