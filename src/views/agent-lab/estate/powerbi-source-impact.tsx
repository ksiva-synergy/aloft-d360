'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/lib/navigation/link';
import { useRouter, useSearchParams } from '@/lib/navigation';
import { ArrowDown, ArrowLeft, ArrowUpRight, BarChart3, ChevronRight, Copy, Loader2, Search, Sigma, Table2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATALOG_BTN, CATALOG_SELECT } from '@/components/estate/catalog-ui';
import { MAX_DRAWN, type ImpactFocusKind, type ImpactReportRow, type ImpactSourceRow, type SourceImpact, type SourceTreeNode } from '@/lib/powerbi/source-impact';
import { traceRelated } from '@/lib/powerbi/report-lineage-graph';
import type { OriginClass } from '@/lib/powerbi/source-origin';
import { CLASS_COLOR, LaneCanvas, type Lane, type LaneEdge, type LaneItem } from '@/components/estate/report-lineage/LaneCanvas';
import { OriginIcon } from '@/components/estate/report-lineage/ReportLineageView';
import { StatusPill, asLineageStatus, copyText } from '@/components/estate/report-lineage/lineage-bits';

type TreeResponse = { tree: SourceTreeNode[]; total_sources: number };
type ImpactResponse = { node: string | null; impact: SourceImpact | null; not_found: boolean };

const BASE = '/agent-lab/estate/powerbi/source-impact';
const API = '/api/agent-lab/powerbi/sources/impact';
/** Rows revealed per "show more" step, in the tree (per parent) and in the lists. */
const PAGE = 50;
/** Hard cap on tree rows rendered at once (a one-letter search can match thousands). */
const MAX_TREE_ROWS = 400;

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
/** "Table" → "tables", "Native query" → "native queries"; null (mixed levels) → "sources". */
function levelNoun(level: string | null | undefined, count: number): string {
  const one = (level ?? 'source').toLowerCase();
  if (count === 1) return one;
  return /[^aeiou]y$/.test(one) ? `${one.slice(0, -1)}ies` : `${one}s`;
}
const countOf = (count: number, level: string | null | undefined) => `${count.toLocaleString()} ${levelNoun(level, count)}`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Page styles: cards and controls follow the theme radius tiers (rounded-card / rounded-ctl).
const CARD = 'rounded-card border border-[var(--estate-border)] bg-[var(--estate-surface)] shadow-card';
const PILL = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--estate-active-bg)] px-2 py-0.5 text-size-caption tabular-nums text-[var(--estate-text-secondary)]';
const ICON_BTN = 'grid size-7 shrink-0 place-items-center rounded-lg text-[var(--estate-text-dim)] transition-colors hover:bg-[var(--estate-hover)] hover:text-[var(--brand-a-ink)]';
const NODE_BOX = 'flex w-full min-w-0 items-start gap-2.5 rounded-ctl border border-[var(--estate-border)] bg-[var(--estate-surface)] px-3 py-2 text-left transition-colors hover:border-[var(--brand-a)]';
const NODE_ICON = 'mt-px grid size-6 shrink-0 place-items-center rounded-lg [&>svg]:size-[13px]';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string; error?: string }).message ?? (json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

function SystemIcon({ cls, system, size = 24 }: { cls: OriginClass; system: string; size?: number }) {
  return (
    <span className={cn('grid shrink-0 place-items-center text-white', size > 30 ? 'rounded-ctl' : 'rounded-lg')} style={{ width: size, height: size, background: CLASS_COLOR[cls] }}>
      <OriginIcon origin={{ system: system as never }} cls={cls} className={size > 30 ? 'size-5' : 'size-3'} />
    </span>
  );
}

/** Ancestor ids of a node, nearest first. */
function ancestors(byId: Map<string, SourceTreeNode>, id: string | null): string[] {
  const out: string[] = [];
  let current = id ? byId.get(id)?.parent ?? null : null;
  while (current) { out.push(current); current = byId.get(current)?.parent ?? null; }
  return out;
}

type TreeRow = { kind: 'node'; node: SourceTreeNode } | { kind: 'more'; parent: string; depth: number };

function SourceTree({ tree, selected, onSelect }: { tree: SourceTreeNode[]; selected: string | null; onSelect: (id: string) => void }) {
  const byId = useMemo(() => new Map(tree.map((node) => [node.id, node])), [tree]);
  const [filter, setFilter] = useState('');
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  /** Children revealed per parent ('' = top level) beyond the first PAGE. */
  const [shown, setShown] = useState<Record<string, number>>({});
  const q = filter.trim().toLowerCase();

  // While searching: show matches plus their ancestors, expanded. Otherwise the selection's path is open.
  const matches = useMemo(() => (q ? new Set(tree.filter((node) => node.label.toLowerCase().includes(q)).map((node) => node.id)) : null), [tree, q]);
  const pinned = useMemo(() => new Set(selected ? [selected, ...ancestors(byId, selected)] : []), [byId, selected]);
  const forcedOpen = useMemo(() => {
    const open = new Set<string>(ancestors(byId, selected));
    if (matches) for (const id of matches) ancestors(byId, id).forEach((a) => open.add(a));
    return open;
  }, [byId, selected, matches]);

  // One pass over the depth-first list: a node shows when its parent shows and is open, it passes the
  // search, and its parent has not used up its page of children (the selection's path always shows).
  const { rows, overflow, truncated } = useMemo(() => {
    const isOpen = (id: string) => toggled[id] ?? forcedOpen.has(id);
    const out: TreeRow[] = [];
    const rendered = new Set<string>();
    const underMatch = new Set<string>();
    const perParent = new Map<string, number>();
    const hidden = new Map<string, number>();
    let cut = 0;
    for (const node of tree) {
      if (node.parent && (!rendered.has(node.parent) || !isOpen(node.parent))) continue;
      if (node.parent && (matches?.has(node.parent) || underMatch.has(node.parent))) underMatch.add(node.id);
      if (matches && !matches.has(node.id) && !forcedOpen.has(node.id) && !underMatch.has(node.id)) continue;
      const parentKey = node.parent ?? '';
      const count = perParent.get(parentKey) ?? 0;
      if (count >= (shown[parentKey] ?? PAGE) && !pinned.has(node.id)) {
        if (!hidden.has(parentKey)) out.push({ kind: 'more', parent: parentKey, depth: node.depth });
        hidden.set(parentKey, (hidden.get(parentKey) ?? 0) + 1);
        continue;
      }
      if (out.length >= MAX_TREE_ROWS && !pinned.has(node.id)) { cut++; continue; }
      perParent.set(parentKey, count + 1);
      rendered.add(node.id);
      out.push({ kind: 'node', node });
    }
    return { rows: out, overflow: hidden, truncated: cut };
  }, [tree, toggled, forcedOpen, matches, pinned, shown]);

  return (
    <aside aria-label="Sources"
      className={cn(CARD, 'flex max-h-[70vh] flex-col overflow-hidden lg:sticky lg:top-5 lg:h-[calc(100dvh-12rem)] lg:max-h-none lg:min-h-[420px]')}>
      <div className="space-y-1.5 border-b border-[var(--estate-border)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--estate-text-dim)]" aria-hidden />
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search sources"
            aria-label="Search sources" className={cn(CATALOG_SELECT, 'h-9 w-full pl-8')} />
        </div>
        {matches && <p className="px-0.5 text-size-caption text-[var(--estate-text-muted)]">{plural(matches.size, 'result')}</p>}
      </div>
      <ul role="tree" aria-label="Source hierarchy" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-2 scrollbar-thin">
        {rows.map((row) => {
          if (row.kind === 'more') {
            const more = overflow.get(row.parent) ?? 0;
            return (
              <li key={`more:${row.parent}`} role="none" style={{ paddingLeft: row.depth * 14 + 20 }}>
                <button type="button" onClick={() => setShown((prev) => ({ ...prev, [row.parent]: (prev[row.parent] ?? PAGE) + PAGE }))}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-size-caption font-medium text-[var(--brand-a-ink)] hover:bg-[var(--estate-hover)]">
                  Show more <span className="font-normal text-[var(--estate-text-muted)]">({more.toLocaleString()})</span>
                </button>
              </li>
            );
          }
          const { node } = row;
          const open = toggled[node.id] ?? forcedOpen.has(node.id);
          const active = node.id === selected;
          return (
            <li key={node.id} role="treeitem" aria-level={node.depth + 1} aria-expanded={node.leaf ? undefined : open} aria-selected={active}
              className="flex min-w-0 items-center gap-1" style={{ paddingLeft: node.depth * 14 }}>
              {node.leaf ? <span className="w-6 shrink-0" /> : (
                <button type="button" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
                  onClick={() => setToggled((prev) => ({ ...prev, [node.id]: !open }))}
                  className="grid size-6 shrink-0 place-items-center rounded-lg text-[var(--estate-text-dim)] hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]">
                  <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
                </button>
              )}
              <button type="button" onClick={() => onSelect(node.id)} title={`${node.level}: ${node.label}`}
                className={cn('flex min-w-0 flex-1 items-center gap-2.5 rounded-ctl border px-2 py-1.5 text-left transition-colors',
                  active ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)]' : 'border-transparent hover:bg-[var(--estate-hover)]',
                  matches && !matches.has(node.id) && 'opacity-60')}>
                {node.depth === 0 && <SystemIcon cls={node.cls} system={node.system} />}
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[var(--estate-ink)]', node.depth === 0 ? 'text-size-ui font-medium' : 'text-size-ui')}>{node.label}</span>
                  <span className="block truncate text-size-caption text-[var(--estate-text-muted)]">
                    {node.depth === 0 ? plural(node.sources, 'source') : node.leaf ? node.level : `${node.level} · ${countOf(node.sources, node.leaf_level)}`}
                  </span>
                </span>
                <span className={PILL} title={`${plural(node.reports, 'report')} · ${plural(node.models, 'model')} · ${plural(node.tables, 'model table')}`}>
                  <BarChart3 className="size-3" aria-hidden />{node.reports.toLocaleString()}
                </span>
              </button>
            </li>
          );
        })}
        {truncated > 0 && (
          <li role="none" className="px-2 py-2 text-size-caption text-[var(--estate-text-muted)]">
            +{truncated.toLocaleString()} more. Refine the search.
          </li>
        )}
        {!rows.length && (
          <li className="px-2 py-8 text-center text-caption text-[var(--estate-text-muted)]">
            {tree.length ? 'No results' : 'No sources yet'}
          </li>
        )}
      </ul>
    </aside>
  );
}

function SystemOverview({ tree, onSelect }: { tree: SourceTreeNode[]; onSelect: (id: string) => void }) {
  const systems = tree.filter((node) => node.depth === 0);
  if (!systems.length) return null;
  return (
    <section aria-label="Source systems" className={cn(CARD, 'overflow-hidden')}>
      <h2 className="border-b border-[var(--estate-border)] px-5 py-4 text-title-card text-[var(--estate-ink)]">Source systems</h2>
      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
        {systems.map((system) => {
          const children = tree.filter((node) => node.parent === system.id);
          const level = children[0]?.level;
          return (
            <button key={system.id} type="button" onClick={() => onSelect(system.id)}
              className="flex items-start gap-3.5 rounded-ctl border border-[var(--estate-border)] bg-[var(--estate-surface)] p-4 text-left transition-colors hover:border-[var(--brand-a)] hover:bg-[var(--estate-hover)]">
              <SystemIcon cls={system.cls} system={system.system} size={36} />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-ui font-medium text-[var(--estate-ink)]">{system.label}</span>
                <span className="block text-caption text-[var(--estate-text-muted)]">
                  {level ? `${plural(children.length, level.toLowerCase())} · ` : ''}{plural(system.sources, 'source')}
                </span>
                <span className="flex flex-wrap gap-1.5 pt-0.5">
                  <span className={PILL}>{plural(system.reports, 'report')}</span>
                  <span className={PILL}>{plural(system.models, 'model')}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Lists (broad scopes: hundreds of tables in a catalog) ──────────────────────────────────────

type Column<T> = { key: string; label: string; numeric?: boolean; value: (row: T) => number | string; render?: (row: T) => React.ReactNode };

function ListToolbar({ query, onQuery, placeholder, children }: { query: string; onQuery: (q: string) => void; placeholder: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
      <div className="relative min-w-[220px] flex-[1_1_260px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--estate-text-dim)]" aria-hidden />
        <input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder}
          className={cn(CATALOG_SELECT, 'h-9 w-full pl-8')} />
      </div>
      {children}
    </div>
  );
}

type Sort = { key: string; desc: boolean };

/** Click a header to sort by it; numbers sort largest first, text A→Z; click again to reverse. */
function SortableHead({ columns, sort, onSort }: { columns: { key: string; label: string; numeric?: boolean }[]; sort: Sort; onSort: (next: (prev: Sort) => Sort) => void }) {
  return (
    <thead>
      <tr className="border-b border-[var(--estate-border)] bg-[var(--estate-active-bg)] text-left">
        {columns.map((column) => {
          const active = sort.key === column.key;
          return (
            <th key={column.key} scope="col" aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
              className={cn('px-3 py-2 font-normal', column.numeric && 'w-[104px] text-right')}>
              <button type="button"
                onClick={() => onSort((prev) => ({ key: column.key, desc: prev.key === column.key ? !prev.desc : Boolean(column.numeric) }))}
                className={cn('inline-flex items-center gap-1 text-eyebrow uppercase hover:text-[var(--estate-ink)]',
                  active ? 'text-[var(--estate-ink)]' : 'text-[var(--estate-text-secondary)]')}>
                {column.label}
                {active && <ArrowDown className={cn('size-3', !sort.desc && 'rotate-180')} aria-hidden />}
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

const compareBy = (x: number | string, y: number | string, desc: boolean) =>
  (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * (desc ? -1 : 1);

/** A sortable, paged table. Sorting is by clicking a column header. */
function DataTable<T extends { id: string }>({ label, rows, columns, defaultSort, capped, noun }: {
  label: string; rows: T[]; columns: Column<T>[]; defaultSort: string;
  /** Set to the list size when the server cut the list short (MAX_LIST_ROWS). */
  capped: number | null; noun: string;
}) {
  const [sort, setSort] = useState<Sort>({ key: defaultSort, desc: true });
  // Paging restarts whenever the (filtered) rows change.
  const [paging, setPaging] = useState({ rows, limit: PAGE });
  const limit = paging.rows === rows ? paging.limit : PAGE;
  const setLimit = (next: (n: number) => number) => setPaging({ rows, limit: next(limit) });
  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort.key) ?? columns[0]!;
    return [...rows].sort((a, b) => compareBy(column.value(a), column.value(b), sort.desc));
  }, [rows, columns, sort]);
  const visible = sorted.slice(0, limit);
  return (
    <div className="px-5 pb-4 pt-3">
      <div className="overflow-x-auto rounded-ctl border border-[var(--estate-border)] scrollbar-thin">
        <table aria-label={label} className="w-full min-w-[560px] border-collapse text-size-ui">
          <SortableHead columns={columns} sort={sort} onSort={setSort} />
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-[var(--estate-border)] last:border-b-0 hover:bg-[var(--estate-hover)]">
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-3 py-2 align-middle', column.numeric && 'text-right tabular-nums text-[var(--estate-text-secondary)]')}>
                    {column.render ? column.render(row) : column.value(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="py-8 text-center text-caption text-[var(--estate-text-muted)]">No results</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-size-caption text-[var(--estate-text-muted)]">
        <span>{Math.min(limit, sorted.length).toLocaleString()} of {sorted.length.toLocaleString()} {noun}</span>
        {sorted.length > limit && (
          <>
            <button type="button" onClick={() => setLimit((n) => n + PAGE)} className={CATALOG_BTN}>Show {Math.min(PAGE, sorted.length - limit)} more</button>
            <button type="button" onClick={() => setLimit(() => sorted.length)} className="font-medium hover:text-[var(--estate-ink)]">Show all</button>
          </>
        )}
        {capped && <span>Top {capped.toLocaleString()} shown</span>}
      </div>
    </div>
  );
}

/** A catalog / schema (any level between the scope and its tables) holding part of the list. */
type Group = { id: string; level: string; label: string; depth: number; groups: Group[]; rows: ImpactSourceRow[]; leaves: number };

function groupRows(rows: ImpactSourceRow[]): Group {
  const root: Group = { id: '', level: '', label: '', depth: -1, groups: [], rows: [], leaves: 0 };
  const index = new Map<string, Group>();
  for (const row of rows) {
    let parent = root;
    root.leaves++;
    row.parents.forEach((segment, depth) => {
      let group = index.get(segment.id);
      if (!group) {
        group = { id: segment.id, level: segment.level, label: segment.label, depth, groups: [], rows: [], leaves: 0 };
        index.set(segment.id, group);
        parent.groups.push(group);
      }
      group.leaves++;
      parent = group;
    });
    parent.rows.push(row);
  }
  return root;
}

type SourceColumn = { key: 'name' | 'reports' | 'models' | 'tables' | 'measures'; label: string; numeric?: boolean };
type Line =
  | { kind: 'group'; group: Group; open: boolean }
  | { kind: 'row'; row: ImpactSourceRow; depth: number }
  | { kind: 'more'; group: string; depth: number; hidden: number };

const INDENT = 18;

// A group's numbers come from the source tree (distinct reports etc.), not sums of its rows.
function groupValue(nodes: Map<string, SourceTreeNode>, group: Group, key: SourceColumn['key']): number | string {
  if (key === 'name') return group.label;
  return nodes.get(group.id)?.[key] ?? 0;
}
const rowValue = (row: ImpactSourceRow, key: SourceColumn['key']): number | string => (key === 'name' ? row.label : row[key]);

function SourceLink({ row, depth, onSelect }: { row: ImpactSourceRow; depth: number; onSelect: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(row.id)} title={`Open ${row.label}`}
      className="group flex min-w-0 max-w-full items-center gap-2 text-left" style={{ paddingLeft: depth * INDENT }}>
      <span className={cn(NODE_ICON, 'mt-0 border border-[var(--estate-border)] bg-[var(--estate-active-bg)] text-[var(--estate-text-secondary)]')}><Table2 aria-hidden /></span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-[var(--estate-ink)] group-hover:text-[var(--brand-a-ink)] group-hover:underline">{row.label}</span>
        {depth === 0 && row.path && <span className="block truncate font-mono text-size-caption text-[var(--estate-text-muted)]">{row.path}</span>}
      </span>
    </button>
  );
}

/**
 * Every table under a broad scope. Grouped by the levels in between (catalog › schema › table for a
 * Databricks workspace), each group collapsible and showing its own totals; or as one flat list.
 */
function SourceList({ impact, nodes, onSelect }: { impact: SourceImpact; nodes: Map<string, SourceTreeNode>; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const groupable = useMemo(() => impact.source_rows.some((row) => row.parents.length > 0), [impact]);
  const [flat, setFlat] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'reports', desc: true });
  /** `base` set by Expand all / Collapse all; `ids` = groups toggled since. */
  const [expanded, setExpanded] = useState<{ base: boolean | null; ids: Record<string, boolean> }>({ base: null, ids: {} });
  const [limits, setLimits] = useState<Record<string, number>>({});
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => impact.source_rows.filter((row) =>
    !q || row.label.toLowerCase().includes(q) || (row.path ?? '').toLowerCase().includes(q)), [impact, q]);
  const noun = levelNoun(impact.leaf_level, 2);
  const grouped = groupable && !flat;
  const tree = useMemo(() => groupRows(rows), [rows]);

  const columns: SourceColumn[] = [
    { key: 'name', label: capital(levelNoun(impact.leaf_level, 1)) },
    { key: 'reports', label: 'Reports', numeric: true },
    { key: 'models', label: 'Models', numeric: true },
    { key: 'tables', label: 'Model tables', numeric: true },
    { key: 'measures', label: 'Measures', numeric: true },
  ];
  const sortKey = sort.key as SourceColumn['key'];

  const lines = useMemo(() => {
    const out: Line[] = [];
    const isOpen = (group: Group, siblings: number) =>
      Boolean(q) || (expanded.ids[group.id] ?? expanded.base ?? siblings === 1);
    const addRows = (owner: Group) => {
      const sorted = [...owner.rows].sort((a, b) => compareBy(rowValue(a, sortKey), rowValue(b, sortKey), sort.desc));
      const limit = limits[owner.id] ?? PAGE;
      for (const row of sorted.slice(0, limit)) out.push({ kind: 'row', row, depth: owner.depth + 1 });
      if (sorted.length > limit) out.push({ kind: 'more', group: owner.id, depth: owner.depth + 1, hidden: sorted.length - limit });
    };
    const visit = (owner: Group) => {
      const groups = [...owner.groups].sort((a, b) => compareBy(groupValue(nodes, a, sortKey), groupValue(nodes, b, sortKey), sort.desc));
      for (const group of groups) {
        const open = isOpen(group, groups.length);
        out.push({ kind: 'group', group, open });
        if (open) visit(group);
      }
      addRows(owner);
    };
    if (grouped) visit(tree);
    else addRows({ ...tree, rows });
    return out;
  }, [tree, rows, grouped, q, expanded, limits, sortKey, sort.desc, nodes]);

  const toggle = (id: string, open: boolean) => setExpanded((prev) => ({ ...prev, ids: { ...prev.ids, [id]: !open } }));
  // e.g. ["Catalog", "Schema"] under a Databricks workspace
  const innerLevels = useMemo(() => [...new Set(impact.source_rows.flatMap((row) => row.parents.map((p) => p.level)))], [impact]);

  return (
    <div>
      <ListToolbar query={query} onQuery={setQuery} placeholder={`Search ${noun} in ${impact.scope.label}`}>
        {groupable && (
          <div role="group" aria-label="List layout" className="inline-flex h-9 items-center rounded-ctl border border-[var(--estate-border)] p-1">
            {([[false, innerLevels.length ? `By ${innerLevels.map((l) => l.toLowerCase()).join(' › ')}` : 'Grouped'], [true, 'Flat list']] as const).map(([value, label]) => (
              <button key={label} type="button" aria-pressed={flat === value} onClick={() => setFlat(value)}
                className={cn('h-full rounded-lg px-2.5 text-size-caption transition-colors', flat === value ? 'bg-[var(--estate-active-bg)] font-medium text-[var(--estate-ink)]' : 'text-[var(--estate-text-secondary)] hover:text-[var(--estate-ink)]')}>
                {label}
              </button>
            ))}
          </div>
        )}
        {grouped && !q && (
          <>
            <button type="button" className={cn(CATALOG_BTN, 'h-9')} onClick={() => setExpanded({ base: true, ids: {} })}>Expand all</button>
            <button type="button" className={cn(CATALOG_BTN, 'h-9')} onClick={() => setExpanded({ base: false, ids: {} })}>Collapse all</button>
          </>
        )}
      </ListToolbar>
      <div className="px-5 pb-4 pt-3">
        <div className="overflow-x-auto rounded-ctl border border-[var(--estate-border)] scrollbar-thin">
          <table aria-label={`${capital(noun)} in ${impact.scope.label}`} className="w-full min-w-[560px] border-collapse text-size-ui">
            <SortableHead columns={columns} sort={sort} onSort={setSort} />
            <tbody>
              {lines.map((line) => {
                if (line.kind === 'more') {
                  return (
                    <tr key={`more:${line.group}`}>
                      <td colSpan={columns.length} className="px-3 py-2">
                        <button type="button" style={{ paddingLeft: line.depth * INDENT }}
                          onClick={() => setLimits((prev) => ({ ...prev, [line.group]: (prev[line.group] ?? PAGE) + PAGE }))}
                          className="text-size-caption font-medium text-[var(--brand-a-ink)] hover:underline">
                          Show more <span className="font-normal text-[var(--estate-text-muted)]">({line.hidden.toLocaleString()})</span>
                        </button>
                      </td>
                    </tr>
                  );
                }
                if (line.kind === 'group') {
                  const { group, open } = line;
                  const name = `${group.level.toLowerCase()} ${group.label}`;
                  return (
                    <tr key={`g:${group.id}`} className="border-b border-[var(--estate-border)] hover:bg-[var(--estate-hover)]">
                      <td className="px-3 py-2">
                        <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: group.depth * INDENT }}>
                          <button type="button" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} disabled={Boolean(q)}
                            onClick={() => toggle(group.id, open)}
                            className="flex min-w-0 items-center gap-2 rounded-lg text-left disabled:cursor-default">
                            <ChevronRight className={cn('size-3.5 shrink-0 text-[var(--estate-text-dim)] transition-transform', open && 'rotate-90')} aria-hidden />
                            <span className="truncate font-medium text-[var(--estate-ink)]">{group.label}</span>
                            <span className={PILL}>{group.level}</span>
                            <span className="shrink-0 text-size-caption text-[var(--estate-text-muted)]">
                              {q ? `${group.leaves.toLocaleString()} matching` : countOf(nodes.get(group.id)?.sources ?? group.leaves, impact.leaf_level)}
                            </span>
                          </button>
                          <button type="button" aria-label={`Open ${name}`} title={`Open ${group.level.toLowerCase()}`} onClick={() => onSelect(group.id)}
                            className={cn(ICON_BTN, 'ml-auto')}>
                            <ArrowUpRight className="size-3.5" aria-hidden />
                          </button>
                        </div>
                      </td>
                      {columns.slice(1).map((column) => (
                        <td key={column.key} className="px-3 py-2 text-right tabular-nums font-medium text-[var(--estate-text-secondary)]">
                          {Number(groupValue(nodes, group, column.key)).toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  );
                }
                const { row, depth } = line;
                return (
                  <tr key={row.id} className="border-b border-[var(--estate-border)] last:border-b-0 hover:bg-[var(--estate-hover)]">
                    <td className="px-3 py-2"><SourceLink row={row} depth={grouped ? depth : 0} onSelect={onSelect} /></td>
                    {columns.slice(1).map((column) => (
                      <td key={column.key} className="px-3 py-2 text-right tabular-nums text-[var(--estate-text-secondary)]">{Number(rowValue(row, column.key)).toLocaleString()}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="py-8 text-center text-caption text-[var(--estate-text-muted)]">No results</p>}
        <p className="pt-3 text-size-caption text-[var(--estate-text-muted)]">
          {q ? `${countOf(rows.length, impact.leaf_level)} match` : countOf(rows.length, impact.leaf_level)}
          {grouped && tree.groups.length > 0 && ` in ${plural(tree.groups.length, (tree.groups[0]!.level).toLowerCase())}`}
          {impact.source_rows.length < impact.totals.leaves && ` · top ${impact.source_rows.length.toLocaleString()} shown`}
        </p>
      </div>
    </div>
  );
}

function ReportList({ impact, onTrace }: { impact: SourceImpact; onTrace: (reportId: string) => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => impact.report_rows.filter((row) =>
    !q || row.name.toLowerCase().includes(q) || (row.model_name ?? '').toLowerCase().includes(q)), [impact, q]);
  const columns = useMemo<Column<ImpactReportRow>[]>(() => [
    {
      key: 'name', label: 'Report', value: (row) => row.name,
      render: (row) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={() => onTrace(row.id)} title="Trace in graph"
            className="group flex min-w-0 items-center gap-2 text-left">
            <span className={cn(NODE_ICON, 'mt-0 bg-[var(--brand-a)] text-white')}><BarChart3 aria-hidden /></span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-[var(--estate-ink)] group-hover:text-[var(--brand-a-ink)] group-hover:underline">{row.name}</span>
              {row.model_name && <span className="block truncate text-size-caption text-[var(--estate-text-muted)]">{row.model_name}</span>}
            </span>
          </button>
          <Link href={reportHref(row.id)} aria-label={`Open lineage of ${row.name}`} title="Report lineage" className={ICON_BTN}>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      ),
    },
    { key: 'status', label: 'Lineage', value: (row) => row.status, render: (row) => <StatusPill status={asLineageStatus(row.status)} /> },
    { key: 'sources', label: `${capital(levelNoun(impact.leaf_level, 2))} read`, numeric: true, value: (row) => row.sources },
    {
      key: 'measures', label: 'Measures', numeric: true, value: (row) => row.measures,
      render: (row) => (row.measures ? row.measures.toLocaleString() : <span title="Linked through the model">model-wide</span>),
    },
  ], [impact.leaf_level, onTrace]);
  return (
    <div>
      <ListToolbar query={query} onQuery={setQuery} placeholder="Search reports or models" />
      <DataTable label="Affected reports" rows={rows} columns={columns} defaultSort="sources" noun="reports"
        capped={impact.report_rows.length < impact.totals.reports ? impact.report_rows.length : null} />
    </div>
  );
}

// ── Graph (one table, or the most-used part of a broad scope) ─────────────────────────────────

const reportHref = (id: string) => `/agent-lab/estate/powerbi/reports/${encodeURIComponent(id)}/lineage`;
const FOCUS_NOUN: Record<ImpactFocusKind, string> = { source: 'source', table: 'model table', measure: 'measure', report: 'report' };

type LaneKey = 'sources' | 'tables' | 'measures' | 'reports';
/** One drawn node before grouping: its lane group (schema / semantic model) and its box. */
type GraphNode = { id: string; group: string | null; content: React.ReactNode };

const groupId = (lane: LaneKey, group: string) => `g:${lane}|${group}`;
const LANE_NAME: Record<LaneKey, string> = { sources: 'sources', tables: 'model tables', measures: 'measures', reports: 'reports' };

/** Clusters a lane's nodes by group (first appearance order, so the most-used group leads). */
function clusterByGroup(nodes: GraphNode[]): GraphNode[] {
  const order = new Map<string, number>();
  nodes.forEach((node) => { if (node.group != null && !order.has(node.group)) order.set(node.group, order.size); });
  return nodes.map((node, index) => ({ node, index }))
    .sort((a, b) => (order.get(a.node.group ?? '') ?? -1) - (order.get(b.node.group ?? '') ?? -1) || a.index - b.index)
    .map(({ node }) => node);
}

/**
 * The impact graph. Each lane is grouped (sources by schema, the rest by semantic model) and every
 * group collapses into one summary box that keeps its lines. Clicking a box narrows the graph to the
 * paths through it (fetched from the server, so nothing is lost to the per-lane cap); hovering traces it.
 */
function ImpactGraph({ base, graph, loading, error, focusId, onFocus }: {
  base: SourceImpact; graph: SourceImpact; loading: boolean; error: string | null; focusId: string | null; onFocus: (id: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = focusId && graph.focus?.id === focusId ? graph.focus : null;

  const { lanes, edges, groups } = useMemo(() => {
    const box = NODE_BOX;
    const icon = NODE_ICON;
    const click = (id: string) => () => onFocus(id === focusId ? null : id);
    const label = (kind: ImpactFocusKind, name: string) => (focusId ? `Focus on ${FOCUS_NOUN[kind]} ${name}` : `Show only what connects to ${FOCUS_NOUN[kind]} ${name}`);
    const raw: Record<LaneKey, GraphNode[]> = {
      sources: graph.sources.map((source) => ({
        id: source.id,
        group: graph.scope.leaf ? null : source.path ?? source.group,
        content: (
          <button type="button" className={box} title={`${source.title} · ${source.group}`} aria-label={label('source', source.title)} onClick={click(source.id)}>
            <SystemIcon cls={source.cls} system={source.system} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]">{source.title}</span>
              {source.subtitle && <span className="block truncate font-mono text-size-caption text-[var(--estate-text-muted)]">{source.subtitle}</span>}
            </span>
          </button>
        ),
      })),
      tables: graph.tables.map((table) => ({
        id: table.id,
        group: table.model_name ?? 'Unknown model',
        content: (
          <button type="button" className={box} aria-label={label('table', table.name)} onClick={click(table.id)}>
            <span className={cn(icon, 'border border-[var(--estate-border)] bg-[var(--estate-active-bg)] text-[var(--estate-text-secondary)]')}><Table2 /></span>
            <span className="min-w-0 flex-1 truncate text-size-ui font-medium text-[var(--estate-ink)]" title={table.name}>{table.name}</span>
          </button>
        ),
      })),
      measures: graph.measures.map((measure) => ({
        id: measure.id,
        group: measure.model_name ?? 'Unknown model',
        content: (
          <button type="button" className={box} aria-label={label('measure', measure.name)} onClick={click(measure.id)}>
            <span className={cn(icon, 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]')}><Sigma /></span>
            <span className="min-w-0 flex-1 truncate text-size-ui font-medium text-[var(--estate-ink)]" title={measure.name}>{measure.name}</span>
          </button>
        ),
      })),
      reports: graph.reports.map((report) => ({
        id: report.id,
        group: report.model_name ?? 'Unknown model',
        content: (
          <div className="relative">
            <button type="button" className={cn(box, 'pr-8')} aria-label={label('report', report.name)} onClick={click(report.id)}>
              <span className={cn(icon, 'bg-[var(--brand-a)] text-white')}><BarChart3 /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]" title={report.name}>{report.name}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  <StatusPill status={asLineageStatus(report.status)} />
                  <span className={PILL}>{report.measure_count ? plural(report.measure_count, 'measure') : 'Model-wide'}</span>
                </span>
              </span>
            </button>
            <Link href={reportHref(report.id)} aria-label={`Open lineage of ${report.name}`} title="Report lineage"
              className={cn(ICON_BTN, 'absolute right-1 top-1 size-6')}>
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        ),
      })),
    };

    // Collapse: a collapsed group's nodes become one summary box; their lines move to it.
    const alias = new Map<string, string>();
    const allGroups: string[] = [];
    const laneItems = (lane: LaneKey, noun: string): LaneItem[] => {
      const items: LaneItem[] = [];
      const clustered = clusterByGroup(raw[lane]);
      const sizes = new Map<string, number>();
      for (const node of clustered) if (node.group != null) sizes.set(node.group, (sizes.get(node.group) ?? 0) + 1);
      for (const node of clustered) {
        const group = node.group;
        const gid = group != null ? groupId(lane, group) : null;
        const isCollapsed = gid != null && collapsed.has(gid);
        const groupTitle = group != null && gid != null ? (
          <button type="button" aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group} in ${LANE_NAME[lane]}`}
            onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(gid)) next.delete(gid); else next.add(gid); return next; })}
            className="flex min-w-0 items-center gap-1 rounded-lg text-left hover:text-[var(--estate-ink)]">
            <ChevronRight className={cn('size-3 shrink-0 transition-transform', !isCollapsed && 'rotate-90')} aria-hidden />
            <span className="truncate">{group}</span>
            <span className="shrink-0 tabular-nums text-[var(--estate-text-dim)]">{sizes.get(group)}</span>
          </button>
        ) : undefined;
        if (gid && !allGroups.includes(gid)) allGroups.push(gid);
        if (isCollapsed && gid) {
          alias.set(node.id, gid);
          if (items.some((item) => item.id === gid)) continue;
          const count = sizes.get(group!) ?? 0;
          // One compact box per collapsed group (no separate header); it keeps the group's lines.
          items.push({
            id: gid,
            content: (
              <button type="button" aria-expanded={false} aria-label={`Expand ${group} in ${LANE_NAME[lane]}`} title={`${group} · ${plural(count, noun)}`}
                onClick={() => setCollapsed((prev) => { const next = new Set(prev); next.delete(gid); return next; })}
                className="flex w-full min-w-0 items-center gap-2 rounded-ctl border border-dashed border-[var(--estate-border)] bg-[var(--estate-surface)] px-2.5 py-2 text-left transition-colors hover:border-[var(--brand-a)]">
                <ChevronRight className="size-3.5 shrink-0 text-[var(--estate-text-dim)]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-size-ui font-medium text-[var(--estate-ink)]">{group}</span>
                  <span className="block truncate text-size-caption tabular-nums text-[var(--estate-text-muted)]">{plural(count, noun)}</span>
                </span>
              </button>
            ),
          });
          continue;
        }
        items.push({ id: node.id, group: group ?? undefined, groupTitle, content: node.content });
      }
      return items;
    };
    const more = (lane: LaneKey, hidden: number): LaneItem[] => (hidden > 0 ? [{
      id: `more-${lane}`,
      content: <p className="px-1 text-caption text-[var(--estate-text-muted)]">+{hidden.toLocaleString()} more</p>,
    }] : []);
    const built: Lane[] = [
      {
        key: 'sources', label: graph.scope.leaf ? 'Source' : 'Sources', count: graph.sources.length + graph.hidden_sources,
        items: [...laneItems('sources', levelNoun(graph.leaf_level, 1)), ...more('sources', graph.hidden_sources)],
      },
      {
        key: 'tables', label: 'Model tables', count: graph.tables.length + graph.hidden_tables,
        items: [...laneItems('tables', 'model table'), ...more('tables', graph.hidden_tables)],
      },
      {
        key: 'measures', label: 'Measures', count: graph.measures.length + graph.hidden_measures,
        empty: <p className="px-1 text-caption text-[var(--estate-text-muted)]">No measures detected</p>,
        items: [...laneItems('measures', 'measure'), ...(graph.measures.length ? more('measures', graph.hidden_measures) : [])],
      },
      {
        key: 'reports', label: 'Reports', count: graph.reports.length + graph.hidden_reports,
        items: [...laneItems('reports', 'report'), ...more('reports', graph.hidden_reports)],
      },
    ];
    const seen = new Set<string>();
    const lineEdges: LaneEdge[] = [];
    for (const edge of graph.edges) {
      const from = alias.get(edge.from) ?? edge.from;
      const to = alias.get(edge.to) ?? edge.to;
      const key = `${from}>${to}>${edge.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lineEdges.push({ ...edge, from, to });
    }
    return { lanes: built, edges: lineEdges, groups: allGroups };
  }, [graph, collapsed, focusId, onFocus]);

  const trace = useMemo(() => (hovered && !loading ? traceRelated(edges, [hovered]) : null), [edges, hovered, loading]);
  const all = useMemo(() => edges.map((_, i) => i), [edges]);
  const capped = graph.hidden_sources + graph.hidden_tables + graph.hidden_measures + graph.hidden_reports > 0;
  const allCollapsed = groups.length > 0 && groups.every((id) => collapsed.has(id));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        {focus ? (
          <div role="status" className="flex min-h-9 min-w-0 flex-[1_1_320px] flex-wrap items-center gap-x-3 gap-y-1 rounded-ctl border border-[var(--brand-a)] bg-[var(--brand-a-soft)] py-1 pl-3 pr-1 text-size-ui text-[var(--estate-ink)]">
            <span className="min-w-0">Filtered to {FOCUS_NOUN[focus.kind]} <b className="break-all font-semibold">{focus.label}</b></span>
            <span className="text-size-caption tabular-nums text-[var(--estate-text-secondary)]">
              {[
                countOf(graph.sources.length + graph.hidden_sources, base.leaf_level),
                plural(graph.tables.length + graph.hidden_tables, 'model table'),
                plural(graph.measures.length + graph.hidden_measures, 'measure'),
                plural(graph.reports.length + graph.hidden_reports, 'report'),
              ].join(' · ')}
            </span>
            <button type="button" onClick={() => onFocus(null)} className={cn(CATALOG_BTN, 'ml-auto bg-[var(--estate-surface)]')}>
              <X className="size-3" aria-hidden /> Clear filter
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-2 text-size-caption text-[var(--estate-text-muted)]">
            <span>Select a node to filter its path</span>
            {capped && <span className={PILL}>Top {MAX_DRAWN} per column</span>}
          </div>
        )}
        {loading && <Loader2 className="size-3.5 animate-spin text-[var(--estate-text-muted)]" aria-label="Loading" />}
        {groups.length > 0 && (
          <button type="button" className={cn(CATALOG_BTN, 'h-9')} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups))}>
            {allCollapsed ? 'Expand groups' : 'Collapse groups'}
          </button>
        )}
      </div>
      {error && <p role="alert" className="px-5 pt-2 text-caption text-[var(--estate-text-muted)]">Couldn't filter: {error}</p>}
      <div className={cn('transition-opacity', loading && 'opacity-60')}>
        <LaneCanvas
          ariaLabel={`Everything that depends on ${base.scope.label}`}
          lanes={lanes}
          edges={edges}
          hotNodes={trace?.nodes ?? null}
          hotEdges={trace?.edges ?? null}
          selectedId={focus?.id ?? null}
          animateEdges={trace ? [...trace.edges] : all}
          onHover={(id) => setHovered(id && !id.startsWith('more-') ? id : null)}
          columns="minmax(210px,1fr) minmax(190px,1fr) minmax(190px,1fr) minmax(200px,1fr)"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[var(--estate-border)] px-5 py-3 text-size-caption text-[var(--estate-text-muted)]">
        <span className="inline-flex items-center gap-1.5"><svg viewBox="0 0 26 8" className="h-2 w-[26px]" aria-hidden><path d="M1 4h24" stroke="var(--estate-text-secondary)" strokeWidth={2} /></svg>Detected</span>
        <span className="inline-flex items-center gap-1.5"><svg viewBox="0 0 26 8" className="h-2 w-[26px]" aria-hidden><path d="M1 4h24" stroke="var(--estate-text-secondary)" strokeWidth={2} strokeDasharray="4 4" /></svg>Model-wide (inferred)</span>
      </div>
    </>
  );
}

type View = 'list' | 'reports' | 'graph';

function ImpactPanel({ impact, tree, onSelect }: { impact: SourceImpact; tree: SourceTreeNode[]; onSelect: (id: string) => void }) {
  const nodes = useMemo(() => new Map(tree.map((node) => [node.id, node])), [tree]);
  const views: View[] = impact.scope.leaf ? ['graph', 'reports'] : ['list', 'reports', 'graph'];
  const [view, setView] = useState<View>(views[0]!);
  // Graph focus: the graph node (source / model table / measure / report) the graph is narrowed to.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focused, setFocused] = useState<{ id: string; impact: SourceImpact | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!focusId) return;
    let alive = true;
    getJson<ImpactResponse>(`${API}?node=${encodeURIComponent(impact.scope.id)}&focus=${encodeURIComponent(focusId)}`)
      .then((data) => alive && setFocused({ id: focusId, impact: data.impact, error: data.impact?.focus ? null : 'that item is no longer in the snapshots' }))
      .catch((err: unknown) => alive && setFocused({ id: focusId, impact: null, error: err instanceof Error ? err.message : String(err) }));
    return () => { alive = false; };
  }, [focusId, impact.scope.id]);
  const focusLoading = Boolean(focusId) && focused?.id !== focusId;
  // While a new focus loads, keep showing the previous graph.
  const graph = focusId && focused?.impact?.focus ? focused.impact : impact;
  const trace = useCallback((reportId: string) => { setFocusId(reportId); setView('graph'); }, []);

  const { totals } = impact;
  const stats: [string, number][] = [
    [capital(levelNoun(impact.leaf_level, totals.leaves)), totals.leaves],
    ['Semantic models', totals.models],
    ['Model tables', totals.tables],
    ['Measures', totals.measures],
    ['Reports', totals.reports],
  ];
  const viewLabel: Record<View, string> = {
    list: `${capital(levelNoun(impact.leaf_level, 2))} (${totals.leaves.toLocaleString()})`,
    reports: `Reports (${totals.reports.toLocaleString()})`,
    graph: 'Graph',
  };
  return (
    <section aria-label="Impact" className={cn(CARD, 'min-w-0 max-w-full')}>
      <div className="space-y-4 border-b border-[var(--estate-border)] px-5 pt-4">
        <nav aria-label="Source path" className="flex flex-wrap items-center gap-1 text-caption text-[var(--estate-text-muted)]">
          {impact.breadcrumb.map((crumb, i) => (
            <React.Fragment key={crumb.id}>
              {i > 0 && <ChevronRight className="size-3 text-[var(--estate-text-dim)]" aria-hidden />}
              {i === impact.breadcrumb.length - 1 ? (
                <span className="font-medium text-[var(--estate-ink)]" aria-current="page">{crumb.label}</span>
              ) : (
                <button type="button" title={crumb.level} onClick={() => onSelect(crumb.id)} className="rounded-md px-1 hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]">
                  {crumb.label}
                </button>
              )}
            </React.Fragment>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <SystemIcon cls={impact.scope.cls} system={impact.scope.system} size={40} />
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-title-card text-[var(--estate-ink)]">
              <span className="break-all">{impact.scope.label}</span>
              <span className={PILL}>{impact.scope.level}</span>
            </h2>
            <p className="text-size-caption text-[var(--estate-text-muted)]">{impact.scope.system_label}</p>
          </div>
          <button type="button" className={cn(CATALOG_BTN, 'h-9')}
            onClick={() => void copyText(impact.report_rows.map((report) => report.name).join('\n'), 'Report list')}>
            <Copy className="size-3.5" aria-hidden /> Copy reports
          </button>
        </div>
        <dl aria-label="Totals" className="grid grid-cols-2 gap-px overflow-hidden rounded-ctl border border-[var(--estate-border)] bg-[var(--estate-border)] sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="flex flex-col-reverse gap-0.5 bg-[var(--estate-surface)] px-4 py-3 last:col-span-2 sm:last:col-span-1">
              <dt className="text-size-caption text-[var(--estate-text-muted)]">{label}</dt>
              <dd className="text-kpi-md tabular-nums text-[var(--estate-ink)]">{value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <div role="tablist" aria-label="Impact views" className="-mb-px flex gap-1">
          {views.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
              className={cn('border-b-2 px-3 pb-2.5 pt-1 text-size-ui transition-colors',
                view === key ? 'border-[var(--brand-a)] font-medium text-[var(--estate-ink)]' : 'border-transparent text-[var(--estate-text-secondary)] hover:text-[var(--estate-ink)]')}>
              {viewLabel[key]}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" aria-label={viewLabel[view]}>
        {view === 'list' && <SourceList impact={impact} nodes={nodes} onSelect={onSelect} />}
        {view === 'reports' && <ReportList impact={impact} onTrace={trace} />}
        {view === 'graph' && (
          <ImpactGraph base={impact} graph={graph} loading={focusLoading} error={focusId && focused?.id === focusId ? focused.error : null}
            focusId={focusId} onFocus={setFocusId} />
        )}
      </div>
    </section>
  );
}

export default function PowerBiSourceImpactPage() {
  const router = useRouter();
  const params = useSearchParams();
  const nodeParam = params.get('node');
  const keyParam = params.get('key');
  const requestKey = nodeParam ? `node=${encodeURIComponent(nodeParam)}` : keyParam ? `key=${encodeURIComponent(keyParam)}` : '';

  // The tree loads once; each selection then fetches only its impact.
  const [treeState, setTreeState] = useState<{ error: string | null; data: TreeResponse | null } | null>(null);
  useEffect(() => {
    let alive = true;
    getJson<TreeResponse>(API)
      .then((data) => alive && setTreeState({ error: null, data }))
      .catch((err: unknown) => alive && setTreeState({ error: err instanceof Error ? err.message : String(err), data: null }));
    return () => { alive = false; };
  }, []);

  // `request` the response belongs to; while it differs from the URL a new response is loading.
  const [loaded, setLoaded] = useState<{ request: string; error: string | null; data: ImpactResponse | null } | null>(null);
  useEffect(() => {
    if (!requestKey) return;
    let alive = true;
    getJson<ImpactResponse>(`${API}?${requestKey}`)
      .then((data) => alive && setLoaded({ request: requestKey, error: null, data }))
      .catch((err: unknown) => alive && setLoaded({ request: requestKey, error: err instanceof Error ? err.message : String(err), data: null }));
    return () => { alive = false; };
  }, [requestKey]);

  const tree = treeState?.data?.tree ?? [];
  const impactLoading = Boolean(requestKey) && (!loaded || loaded.request !== requestKey);
  const current = requestKey && !impactLoading ? loaded : null;
  const impact = current?.data?.impact ?? null;
  const selected = nodeParam ?? current?.data?.node ?? null;
  const select = (id: string) => router.replace(`${BASE}?node=${encodeURIComponent(id)}`, { scroll: false });
  const error = current?.error ?? treeState?.error ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden scrollbar-thin">
      <div className="mx-auto w-full min-w-0 max-w-[1400px] space-y-4 px-5 py-5">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href="/agent-lab/estate/powerbi/report-lineage" aria-label="Back to report lineage" title="Report lineage" className={cn(CATALOG_BTN, 'h-9 w-9 justify-center px-0')}>
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <h1 className="text-title-section text-[var(--estate-ink)]">Source impact</h1>
          {(!treeState || impactLoading) && (
            <span role="status" className="inline-flex items-center gap-1.5 text-caption text-[var(--estate-text-muted)]">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…
            </span>
          )}
        </header>

        <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <SourceTree tree={tree} selected={selected} onSelect={select} />
          <div className="min-w-0 space-y-4">
            {error && <p role="alert" className="text-caption text-[var(--estate-text-muted)]">Couldn't load: {error}</p>}
            {impact && <ImpactPanel key={impact.scope.id} impact={impact} tree={tree} onSelect={select} />}
            {current?.data?.not_found && (
              <div className="rounded-card border border-dashed border-[var(--estate-border)] p-8 text-center text-caption text-[var(--estate-text-muted)]">
                Source not found in the latest lineage snapshots.
              </div>
            )}
            {!requestKey && treeState?.data && <SystemOverview tree={tree} onSelect={select} />}
          </div>
        </div>
      </div>
    </div>
  );
}
