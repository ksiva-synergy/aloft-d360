'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Database, Lock, Search, Table2, UsersRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, keyFromName, runAsync, send, type AccessGroup, type DataTag, type Person } from './api';
import { ConsoleSelect, Empty, SplitPane } from './parts';
import { PeoplePicker } from './GiveAccess';
import { ColumnInfoDialog } from './ColumnInfo';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

/* ─────────────────────────────────────────────────────────────────────────────
 * Data tab (simplified model): catalog → schema → table → columns.
 *   Left:  the tree; each row shows who can use it and what protects it.
 *   Right: the selected node: who can use it (set / change / remove), its protections, and for a
 *          table its columns with protections.
 * Names are visible to everyone; values need access, and protected data also needs the protection.
 * ──────────────────────────────────────────────────────────────────────────── */

type Access = 'use' | 'export' | 'block';
type HolderType = 'person' | 'group' | 'builtin';
type NodeRule = { id: string; holderType: HolderType; holderId: string; holderName: string; access: Access; autoApprove: boolean; expiresAt: string | null; from: string };
type NodeProtection = { id: string; tagId: string; name: string; from: string };
type NodeAccess = { rules: NodeRule[]; inheritedRules: NodeRule[]; protections: NodeProtection[]; inheritedProtections: NodeProtection[]; protectedColumns: number };
type DataNode = {
  path: string;
  name: string;
  depth: 1 | 2 | 3;
  kind: 'catalog' | 'schema' | 'table' | 'view';
  childCount: number | null;
  tableCount: number | null;
  inEstate: boolean;
  access: NodeAccess;
  /** Search by meaning: the table's summary (never values). */
  description?: string | null;
  score?: number;
  match?: 'name' | 'meaning';
};
type Column = { name: string; type: string | null; protections: { tagId: string; name: string }[] };

const ACCESS_LABEL: Record<Access, string> = { use: 'Use', export: 'Use + export', block: 'Block' };
const BUILTINS = [
  { id: 'readonly', name: 'Everyone', hint: 'every signed-in person' },
  { id: 'member', name: 'Members', hint: 'Member role and above' },
  { id: 'admin', name: 'Admins', hint: 'Admin role and above' },
];
const ROOT = '';

function holderChips(a: NodeAccess) {
  const names = new Map<string, { name: string; inherited: boolean; block: boolean; access: Access }>();
  for (const r of a.inheritedRules)
    names.set(`${r.holderType}:${r.holderId}:${r.access === 'block'}`, { name: r.holderName, inherited: true, block: r.access === 'block', access: r.access });
  for (const r of a.rules)
    names.set(`${r.holderType}:${r.holderId}:${r.access === 'block'}`, { name: r.holderName, inherited: false, block: r.access === 'block', access: r.access });
  return [...names.values()];
}

function shortBrowseName(node: DataNode, showPath?: boolean): string {
  if (!showPath) return node.name;
  const parts = node.path.split('.');
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return node.path;
}

/** Compact browse-row badges — full detail stays on the right panel when selected. */
function treeBrowseMeta(node: DataNode, hint?: string) {
  const chips = holderChips(node.access);
  const hasUse = hasUseAccess(node.access);
  const wholeProt = node.access.protections.length > 0 || node.access.inheritedProtections.length > 0;

  if (hint) {
    return { accessLabel: null, accessTitle: hint, accessInherited: false, colCount: null as number | null, wholeProt, hint };
  }

  const localRules = node.access.rules.length > 0;
  let accessLabel: string | null = null;
  let accessTitle = '';
  let accessInherited = false;

  if (!hasUse && chips.length === 0) {
    accessLabel = 'No access';
    accessTitle = 'Nobody can use this path';
  } else if (!hasUse) {
    accessLabel = 'Blocked';
    accessTitle = chips.map((c) => `${c.name}: ${ACCESS_LABEL[c.access]}`).join(' · ');
  } else {
    const primary = chips.find((c) => !c.block) ?? chips[0];
    if (primary) {
      const showWho =
        node.depth === 1 || localRules || primary.access !== 'use' || primary.block || chips.length > 1;
      if (showWho) {
        accessLabel = primary.name.length > 14 ? `${primary.name.slice(0, 13)}…` : primary.name;
        accessInherited = primary.inherited;
        accessTitle = `${primary.name} · ${ACCESS_LABEL[primary.access]}${primary.inherited ? ' (from parent)' : ''}`;
        if (chips.length > 1) {
          accessTitle = chips.map((c) => `${c.name} · ${ACCESS_LABEL[c.access]}`).join('; ');
        }
      }
    }
  }

  const colCount =
    node.access.protectedColumns > 0 && (node.depth === 1 || node.depth === 3) ? node.access.protectedColumns : null;

  return { accessLabel, accessTitle, accessInherited, colCount, wholeProt, hint: undefined as string | undefined };
}

function hasUseAccess(a: NodeAccess): boolean {
  return (
    a.rules.some((r) => r.access !== 'block') || a.inheritedRules.some((r) => r.access !== 'block')
  );
}

function DetailHeaderChips({
  node,
  estateHint,
}: {
  node: DataNode;
  estateHint: string | null;
}) {
  const a = node.access;
  const chips: React.ReactNode[] = [];
  for (const r of a.rules) {
    chips.push(
      <span key={`r-${r.id}`} className={cn(s.chip, s.chipFaint)} title={`On this path · ${ACCESS_LABEL[r.access]}`}>
        {r.holderName}
        <span className="opacity-70"> · {ACCESS_LABEL[r.access]}</span>
      </span>,
    );
  }
  for (const r of a.inheritedRules.filter((x) => x.access !== 'block')) {
    if (a.rules.some((loc) => loc.holderId === r.holderId && loc.holderType === r.holderType)) continue;
    chips.push(
      <span key={`i-${r.id}`} className={cn(s.chip, s.chipFaint)} title={`Inherited from ${r.from}`}>
        ↑ {r.holderName}
      </span>,
    );
  }
  if (a.rules.length === 0 && a.inheritedRules.length === 0) {
    chips.push(
      <span key="no-use" className={cn(s.chip, s.chipBad)} title="Nobody can use this path">
        No access
      </span>,
    );
  }
  if (a.protections.length) {
    for (const p of a.protections) {
      chips.push(
        <span key={`p-${p.id}`} className={cn(s.chip, s.chipBrand)} title="Whole-path protection">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          {p.name}
        </span>,
      );
    }
  } else if (!a.inheritedProtections.length) {
    chips.push(
      <span key="path-open" className={cn(s.chip, s.chipFaint)} title="No tag on the whole catalog, schema, or table">
        Path open
      </span>,
    );
  }
  if (a.protectedColumns > 0 && node.depth < 3) {
    chips.push(
      <span key="cols" className={cn(s.chip, s.chipBrand)} title={`${a.protectedColumns} protected columns in subtree`}>
        <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
        {a.protectedColumns} cols
      </span>,
    );
  }
  if (estateHint) {
    chips.push(
      <span key="estate" className={cn(s.chip, s.chipFaint)} title="Harvested estate">
        {estateHint}
      </span>,
    );
  }
  if (chips.length === 0) return null;
  return <div className={s.detailChips}>{chips}</div>;
}

export function DataView({
  people,
  meId,
  isPlatformAdmin,
}: {
  people: Person[];
  meId: string;
  isPlatformAdmin: boolean;
}) {
  const readOnly = useConsoleReadOnly();
  const [children, setChildren] = useState<Record<string, DataNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DataNode[] | null>(null);
  type SelectSource = 'tree' | 'search-name' | 'search-meaning';
  const [selectSource, setSelectSource] = useState<SelectSource>('tree');
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [tags, setTags] = useState<DataTag[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadLevel = useCallback(async (parent: string) => {
    const res = await accessFetch<{ nodes: DataNode[] }>(`/api/access/data-tree${parent ? `?parent=${encodeURIComponent(parent)}` : ''}`);
    setChildren((cur) => ({ ...cur, [parent]: res.nodes }));
  }, []);

  const loadSide = useCallback(async () => {
    const [g, t] = await Promise.all([
      accessFetch<{ groups: AccessGroup[] }>('/api/access/groups'),
      accessFetch<{ tags: DataTag[] }>('/api/access/tags'),
    ]);
    setGroups(g.groups);
    setTags(t.tags);
  }, []);

  useEffect(() => {
    runAsync(() => Promise.all([loadLevel(ROOT), loadSide()]).catch((e) => setError(e instanceof Error ? e.message : 'Could not load data')));
  }, [loadLevel, loadSide]);

  /** After a change: reload every loaded level and the search results. */
  const reloadAll = useCallback(async () => {
    const parents = [ROOT, ...expanded];
    await Promise.all(parents.map((p) => loadLevel(p)));
    if (results && q.trim().length >= 2) {
      const res = await accessFetch<{ nodes: DataNode[] }>(`/api/access/data-tree?q=${encodeURIComponent(q.trim())}`);
      setResults(res.nodes);
    }
  }, [expanded, loadLevel, results, q]);

  async function toggle(node: DataNode) {
    const next = new Set(expanded);
    if (next.has(node.path)) next.delete(node.path);
    else {
      next.add(node.path);
      if (!children[node.path]) await loadLevel(node.path).catch((e) => setError(e instanceof Error ? e.message : 'Could not load'));
    }
    setExpanded(next);
  }

  async function searchNames() {
    const term = q.trim();
    if (term.length < 2) return;
    try {
      const res = await accessFetch<{ nodes: DataNode[] }>(`/api/access/data-tree?q=${encodeURIComponent(term)}`);
      setResults(res.nodes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    }
  }

  const allNodes = useMemo(() => {
    const m = new Map<string, DataNode>();
    for (const list of Object.values(children)) for (const n of list) m.set(n.path, n);
    for (const n of results ?? []) m.set(n.path, n);
    return m;
  }, [children, results]);
  const current = selected ? (allNodes.get(selected) ?? null) : null;

  const roots = children[ROOT];
  const nobodyCanUse = !!roots && roots.length > 0 && roots.every((n) => n.access.rules.filter((r) => r.access !== 'block').length === 0);

  function renderRows(parent: string, level: number): ReactNode {
    const list = children[parent];
    if (!list) return null;
    return list.map((n) => (
      <Fragment key={n.path}>
        <TreeRow
          node={n}
          level={level}
          open={expanded.has(n.path)}
          selected={selected === n.path}
          onToggle={() => void toggle(n)}
          onSelect={() => {
            setSelectSource('tree');
            setSelected(n.path);
          }}
        />
        {expanded.has(n.path) ? renderRows(n.path, level + 1) : null}
      </Fragment>
    ));
  }

  return (
    <SplitPane>
      <aside className={cn(s.listPane, 'min-w-0')} aria-label="Data">
        <div className={cn(s.listHead, '!pb-2')}>
          <span className="text-eyebrow uppercase text-muted-foreground">Browse</span>
          <form
            className={cn(s.protectToolbar, 'gap-1.5 !py-1.5')}
            onSubmit={(e) => {
              e.preventDefault();
              void searchNames();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                className={cn(userStyles.input, s.protectCompactInput)}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find tables…"
                aria-label="Find tables"
              />
            </div>
            {results ? (
              <button type="button" className={cn(s.linkBtn, s.protectCompactBtn, '!px-2')} onClick={() => { setResults(null); setSelected(null); }}>
                Clear
              </button>
            ) : null}
          </form>
        </div>
        <div className={cn(s.listBody, 'compact-scroll')}>
          {nobodyCanUse && !results ? (
            <p className="m-2 flex items-start gap-2 rounded-[8px] bg-[var(--warn-bg)] px-3 py-2 text-caption text-[var(--warn)]" role="status">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Nobody can use any catalog yet. Pick one and give Members (or a group) Use.
            </p>
          ) : null}
          {error ? <p className={cn(s.errorText, 'p-2')}>{error}</p> : null}
          {results ? (
            <>
              {results.length === 0 ? (
                <p className="p-3 text-caption text-muted-foreground">No tables match name or meaning.</p>
              ) : (
                <div className={s.treeBrowse}>
                  {results.map((n) => (
                    <TreeRow
                      key={n.path}
                      node={n}
                      level={0}
                      open={false}
                      selected={selected === n.path && (selectSource === 'search-name' || selectSource === 'search-meaning')}
                      onSelect={() => {
                        setSelectSource(n.match === 'meaning' ? 'search-meaning' : 'search-name');
                        setSelected(n.path);
                      }}
                      showPath
                      hint={n.match === 'meaning' ? (n.description ?? 'Similar meaning') : undefined}
                    />
                  ))}
                </div>
              )}
            </>
          ) : !roots ? (
            <p className="p-3 text-caption text-muted-foreground">Loading…</p>
          ) : (
            <div className={s.treeBrowse}>{renderRows(ROOT, 0)}</div>
          )}
        </div>
      </aside>

      <section className={cn(s.detailPane, 'min-w-0')} role="region" aria-label="Selected data">
        {!current ? (
          <Empty icon={<Database className="h-5 w-5" aria-hidden="true" />}>
            Select something in the tree. You will see who can use it, what is protected, and (for tables) each column.
          </Empty>
        ) : (
          <NodeDetail
            key={current.path}
            node={current}
            groups={groups}
            tags={tags}
            people={people}
            meId={meId}
            readOnly={readOnly}
            isPlatformAdmin={isPlatformAdmin}
            onChanged={async () => {
              await Promise.all([reloadAll(), loadSide()]);
            }}
            selectSource={selectSource}
          />
        )}
      </section>
    </SplitPane>
  );
}

function TreeRow({
  node,
  level,
  open,
  selected,
  onToggle,
  onSelect,
  showPath,
  hint,
}: {
  node: DataNode;
  level: number;
  open: boolean;
  selected: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  showPath?: boolean;
  /** Meaning match: short note in the meta column. */
  hint?: string;
}) {
  const meta = treeBrowseMeta(node, hint);
  const canOpen = node.depth < 3 && (node.childCount ?? 0) > 0;
  const ariaSummary = [meta.accessTitle, meta.colCount ? `${meta.colCount} protected columns` : '', meta.wholeProt ? 'Whole path protected' : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={cn(s.treeRow, s.treeRowBrowse, selected && s.treeRowSelected)}>
      <div className={s.treeName} style={{ paddingLeft: level * 14 }}>
        <button
          type="button"
          className={s.treeToggle}
          aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          aria-expanded={canOpen ? open : undefined}
          disabled={!canOpen || !onToggle}
          onClick={onToggle}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
        </button>
        {node.depth === 3 ? <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <button
          type="button"
          className={s.treeLabel}
          title={ariaSummary ? `${node.path} — ${ariaSummary}` : node.path}
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
        >
          {shortBrowseName(node, showPath)}
        </button>
      </div>
      <div className={s.treeRight}>
        {meta.hint ? (
          <span className={cn(s.chip, s.chipFaint, 'max-w-[7rem] truncate')} title={meta.hint}>
            Similar
          </span>
        ) : null}
        {meta.accessLabel ? (
          <span className={cn(s.chip, s.chipFaint)} title={meta.accessTitle}>
            {meta.accessInherited ? <span aria-hidden="true">↑ </span> : null}
            {meta.accessLabel}
          </span>
        ) : null}
        {meta.wholeProt ? <Lock className="h-3 w-3 shrink-0 text-[var(--brand-a-ink)]" aria-label="Whole path protected" /> : null}
        {meta.colCount ? (
          <span className={cn(s.chip, s.chipBrand)} title={`${meta.colCount} protected column${meta.colCount === 1 ? '' : 's'}`}>
            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
            {meta.colCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ── Selected node ────────────────────────────────────────────────────────── */

function NodeDetail({
  node,
  groups,
  tags,
  people,
  meId,
  readOnly,
  isPlatformAdmin,
  onChanged,
  selectSource,
}: {
  node: DataNode;
  groups: AccessGroup[];
  tags: DataTag[];
  people: Person[];
  meId: string;
  readOnly: boolean;
  isPlatformAdmin: boolean;
  onChanged: () => Promise<void>;
  selectSource: 'tree' | 'search-name' | 'search-meaning';
}) {
  const a = node.access;
  const [giving, setGiving] = useState(false);
  const [protecting, setProtecting] = useState(false);
  const kindWord = node.depth === 1 ? 'catalog' : node.depth === 2 ? 'schema' : node.kind === 'view' ? 'view' : 'table';
  const titleName = node.path.split('.').pop() ?? node.path;
  const estateHint =
    node.tableCount != null && node.depth < 3
      ? `${node.childCount ?? 0} schema${(node.childCount ?? 0) === 1 ? '' : 's'}, ${node.tableCount} table${node.tableCount === 1 ? '' : 's'}`
      : null;

  const needsUse = !hasUseAccess(a);

  return (
    <div className="flex flex-col gap-3">
      <header className={cn(s.detailHead, s.detailHeadCompact, '!mb-2')}>
        <div className="min-w-0 flex-1">
          <h2 className="text-title-section font-semibold">
            {titleName}
            <span className="ml-2 text-caption font-normal text-muted-foreground">{kindWord}</span>
          </h2>
          <p className={s.pathCrumb} title={node.path}>
            {node.path}
          </p>
          <DetailHeaderChips node={node} estateHint={estateHint} />
          {selectSource === 'search-meaning' && node.description ? (
            <p className="mt-2 truncate text-caption text-[var(--brand-a-ink)]" title={node.description}>
              {node.description}
            </p>
          ) : null}
        </div>
        {readOnly ? null : (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button
              type="button"
              className={cn(s.protectCompactBtn, needsUse ? userStyles.primary : userStyles.secondaryButton)}
              onClick={() => {
                setProtecting(false);
                setGiving(true);
              }}
            >
              <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
              Give access
            </button>
            <button
              type="button"
              className={cn(s.protectCompactBtn, userStyles.secondaryButton)}
              onClick={() => {
                setGiving(false);
                setProtecting(true);
              }}
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Protect {kindWord}
            </button>
          </div>
        )}
      </header>

      {!readOnly && needsUse ? (
        <div className={cn(s.protectAccessBanner, s.protectAccessBannerWarn)} role="status">
          <p className="text-caption font-medium text-foreground">Nobody can use this {kindWord} yet — add a Use rule.</p>
        </div>
      ) : null}

      {giving ? (
        <section className={s.detailInlineForm} aria-label="Give access">
          <h3 className="mb-2 text-caption font-semibold">Give Use</h3>
          <GiveRuleForm
            path={node.path}
            kindWord={kindWord}
            groups={groups}
            people={people}
            meId={meId}
            existing={a.rules}
            tags={tags}
            isPlatformAdmin={isPlatformAdmin}
            onCancel={() => setGiving(false)}
            onDone={async () => {
              setGiving(false);
              await onChanged();
            }}
          />
        </section>
      ) : null}
      {protecting ? (
        <section className={s.detailInlineForm} aria-label="Add protection">
          <h3 className="mb-2 text-caption font-semibold">Protect whole {kindWord}</h3>
          <ProtectPathForm
            path={node.path}
            kindWord={kindWord}
            tags={tags.filter((t) => !a.protections.some((p) => p.tagId === t.id))}
            onCancel={() => setProtecting(false)}
            onDone={async () => {
              setProtecting(false);
              await onChanged();
            }}
          />
        </section>
      ) : null}

      <section className={s.detailPanel} aria-label="Access on this path">
        <div className={s.detailSection}>
          <h3 className={s.detailSectionTitle}>Use rules</h3>
          {a.rules.length === 0 ? (
            <p className={s.detailEmpty}>None on this path.</p>
          ) : (
            <div>
              {a.rules.map((r) => (
                <RuleRow key={r.id} rule={r} path={node.path} readOnly={readOnly} onChanged={onChanged} />
              ))}
            </div>
          )}
        </div>
        <div className={s.detailSection}>
          <h3 className={s.detailSectionTitle}>Whole-path protection</h3>
          {a.protections.length === 0 ? (
            <p className={s.detailEmpty}>None — use Protect {kindWord} or tag columns on Protections.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {a.protections.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1">
                  <span className={cn(s.chip, s.chipBrand)}>
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    {p.name}
                  </span>
                  {!readOnly && isPlatformAdmin ? (
                    <InlineReason
                      label="Remove"
                      onConfirm={(reason) => send('/api/access/path-protections', 'DELETE', { tagId: p.tagId, path: node.path, reason }).then(onChanged)}
                    />
                  ) : null}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {a.inheritedRules.length || a.inheritedProtections.length ? (
        <details className={cn(s.detailPanel, s.inheritPanel)} aria-label="Inherited from parent paths">
          <summary className={cn(s.detailSection, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden flex flex-wrap items-baseline justify-between gap-2 !py-2.5')}>
            <span className={s.detailSectionTitle} style={{ margin: 0 }}>
              Inherited
            </span>
            <span className="text-caption text-muted-foreground">Change on parent paths</span>
          </summary>
          <div className={cn(s.detailSection, '!pt-0 flex flex-col gap-1.5')}>
            {a.inheritedRules.map((r) => (
              <p key={r.id} className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
                <span className={cn(s.chip, s.chipFaint, r.access === 'block' && s.chipBad)}>
                  {r.holderName} · {ACCESS_LABEL[r.access]}
                </span>
                <span className="truncate" title={r.from}>
                  from {r.from.split('.').pop() ?? r.from}
                </span>
              </p>
            ))}
            {a.inheritedProtections.map((p) => (
              <p key={p.id} className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
                <span className={cn(s.chip, s.chipBrand)}>
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {p.name}
                </span>
                <span className="truncate" title={p.from}>
                  from {p.from.split('.').pop() ?? p.from}
                </span>
              </p>
            ))}
          </div>
        </details>
      ) : null}

      {node.depth === 3 ? <ColumnsCard table={node.path} tags={tags} readOnly={readOnly} isPlatformAdmin={isPlatformAdmin} onChanged={onChanged} /> : null}
    </div>
  );
}

function RuleRow({ rule, path, readOnly, onChanged }: { rule: NodeRule; path: string; readOnly: boolean; onChanged: () => Promise<void> }) {
  const [to, setTo] = useState<Access | 'none' | null>(null);
  const [autoTo, setAutoTo] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const accessChanged = !!to && to !== rule.access;
  const autoChanged = autoTo !== null && autoTo !== rule.autoApprove;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!accessChanged && !autoChanged) return;
    if (reason.trim().length < 5) {
      setError('Give a reason (at least 5 characters)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await send('/api/access/rules', 'PUT', {
        holderType: rule.holderType,
        holderId: rule.holderId,
        path,
        access: to ?? rule.access,
        autoApprove: autoTo ?? rule.autoApprove,
        reason: reason.trim(),
      });
      setTo(null);
      setAutoTo(null);
      setReason('');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const holderKind = rule.holderType === 'builtin' ? 'Built-in' : rule.holderType === 'group' ? 'Group' : 'Person';
  const currentAccess = to ?? rule.access;

  return (
    <div className={s.detailRuleRow}>
      <div className={s.detailRuleHead}>
        <div className="min-w-0 flex-1">
          <span className={s.detailRuleName}>{rule.holderName}</span>
          <span className={cn(s.detailRuleKind, 'ml-1.5')}>{holderKind}</span>
        </div>
        {!readOnly ? (
          <ConsoleSelect
            className="min-w-[8.5rem] shrink-0"
            value={to ?? rule.access}
            ariaLabel={`Access for ${rule.holderName}`}
            onChange={(v) => setTo(v as Access | 'none')}
            options={[
              { value: 'use', label: 'Use' },
              { value: 'export', label: 'Use + export' },
              { value: 'block', label: 'Block' },
              { value: 'none', label: 'Remove rule' },
            ]}
          />
        ) : (
          <span className={cn(s.chip, rule.access === 'block' && s.chipBad, rule.access === 'export' && s.chipOk)}>{ACCESS_LABEL[rule.access]}</span>
        )}
        {rule.expiresAt ? (
          <span className="text-caption text-muted-foreground" title="Rule expiry">
            {new Date(rule.expiresAt).toLocaleDateString()}
          </span>
        ) : null}
      </div>
      {!readOnly && rule.access !== 'block' && currentAccess !== 'block' && currentAccess !== 'none' ? (
        <label className="flex items-center gap-2 text-caption text-muted-foreground" title="Auto-approve access requests for unprotected data covered by this rule">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={autoTo ?? rule.autoApprove}
            onChange={(e) => setAutoTo(e.target.checked)}
            aria-label={`Auto-approve requests for ${rule.holderName}`}
          />
          Auto-approve unprotected requests
        </label>
      ) : null}
      {accessChanged || autoChanged ? (
        <div className={s.detailRuleEdit}>
          <Input
            className={cn(userStyles.input, s.protectCompactInput, 'min-w-0 flex-1')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            aria-label="Reason"
            autoFocus
          />
          <button type="button" className={cn(s.protectCompactBtn, userStyles.primary)} disabled={busy} onClick={() => void save()}>
            {busy ? '…' : to === 'none' ? 'Remove' : 'Save'}
          </button>
          <button type="button" className={cn(s.linkBtn, 'text-caption')} onClick={() => { setTo(null); setAutoTo(null); }}>
            Cancel
          </button>
          {error ? <span className={s.errorText}>{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function GiveRuleForm({
  path,
  kindWord,
  groups,
  people,
  meId,
  existing,
  tags,
  isPlatformAdmin,
  onCancel,
  onDone,
}: {
  path: string;
  kindWord: string;
  groups: AccessGroup[];
  people: Person[];
  meId: string;
  existing: NodeRule[];
  tags: DataTag[];
  isPlatformAdmin: boolean;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const taken = new Set(existing.map((r) => `${r.holderType}:${r.holderId}`));
  const [kind, setKind] = useState<HolderType>('builtin');
  const [builtinId, setBuiltinId] = useState(BUILTINS.find((b) => !taken.has(`builtin:${b.id}`))?.id ?? 'member');
  const [groupId, setGroupId] = useState(groups.find((g) => !taken.has(`group:${g.id}`))?.id ?? '');
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [access, setAccess] = useState<Access>('use');
  const [auto, setAuto] = useState(false);
  const [reason, setReason] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [approver, setApprover] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Protections on columns below this path, so Use can optionally come with those too.
  const [below, setBelow] = useState<{ tagId: string; columns: number }[]>([]);
  const [withProtected, setWithProtected] = useState(false);
  const [protLevel, setProtLevel] = useState<'full' | 'aggregate'>('full');
  useEffect(() => {
    let live = true;
    runAsync(async () => {
      try {
        const r = await accessFetch<{ tagSummary?: { tagId: string; columns: number }[] }>(`/api/access/column-tags?underPath=${encodeURIComponent(path)}`);
        if (live) setBelow(r.tagSummary ?? []);
      } catch {
        if (live) setBelow([]);
      }
    });
    return () => {
      live = false;
    };
  }, [path]);
  const tagName = new Map(tags.map((tg) => [tg.id, tg.name]));
  const belowTags = below.filter((b) => tagName.has(b.tagId));
  const protectedCols = belowTags.reduce((n, b) => n + b.columns, 0);
  const canGrantProtected = isPlatformAdmin && kind !== 'builtin' && access !== 'block';

  async function save() {
    setError(null);
    if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
    let holders: { holderType: HolderType; holderId: string }[] = [];
    if (kind === 'builtin') holders = [{ holderType: 'builtin', holderId: builtinId }];
    if (kind === 'person') {
      if (!personIds.length) return setError('Pick at least one person');
      holders = personIds.map((id) => ({ holderType: 'person' as const, holderId: id }));
    }
    setBusy(true);
    try {
      if (kind === 'group') {
        let gid = groupId;
        if (gid === '__new__' || !gid) {
          if (newGroup.trim().length < 2) throw new Error('Name the new group');
          if (!approver[0]) throw new Error('Pick who approves requests to join');
          const g = await send<{ group: { id: string } }>('/api/access/groups', 'POST', { key: keyFromName(newGroup), name: newGroup.trim(), ownerIds: [approver[0]], reason: reason.trim() });
          gid = g.group.id;
        }
        holders = [{ holderType: 'group', holderId: gid }];
      }
      for (const h of holders) await send('/api/access/rules', 'PUT', { ...h, path, access, autoApprove: access !== 'block' && auto, reason: reason.trim() });
      if (withProtected && canGrantProtected) {
        try {
          for (const h of holders) {
            for (const b of belowTags) {
              await send('/api/access/tag-grants', 'POST', {
                tagId: b.tagId,
                principalType: h.holderType === 'person' ? 'user' : 'group',
                principalId: h.holderId,
                level: protLevel,
                reason: reason.trim(),
              });
            }
          }
        } catch (e) {
          throw new Error(`Use was saved, but protected-column access failed: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-[var(--surface-2)] p-3">
      <p className="text-caption text-muted-foreground" role="status">
        Applying to this <span className="font-medium text-foreground">{kindWord}</span>:{' '}
        <span className="break-all font-medium text-foreground">{path}</span>
      </p>
      <div className={s.seg} role="radiogroup" aria-label="Give access to">
        {(
          [
            ['builtin', 'Everyone / Members / Admins'],
            ['group', 'A group'],
            ['person', 'Specific people'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={cn(s.segBtn, kind === k && s.segBtnActive)} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      {kind === 'builtin' ? (
        <ConsoleSelect
          className="w-full max-w-md"
          value={builtinId}
          ariaLabel="Built-in group"
          onChange={setBuiltinId}
          options={BUILTINS.map((b) => ({
            value: b.id,
            label: `${b.name} (${b.hint})`,
            disabled: taken.has(`builtin:${b.id}`),
          }))}
        />
      ) : kind === 'group' ? (
        <>
          <ConsoleSelect
            className="w-full max-w-md"
            value={groupId || '__new__'}
            ariaLabel="Group"
            onChange={setGroupId}
            options={[
              ...groups.map((g) => ({
                value: g.id,
                label: `${g.name} (${g.members.filter((m) => !m.expired).length} people)`,
                disabled: taken.has(`group:${g.id}`),
              })),
              { value: '__new__', label: '+ Create a new group' },
            ]}
          />
          {groupId === '__new__' || !groupId ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input className={userStyles.input} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name, e.g. Marine" aria-label="Group name" />
              <PeoplePicker label="Approver" single people={people} value={approver} onChange={setApprover} placeholder="Who approves joining" />
            </div>
          ) : null}
        </>
      ) : (
        <PeoplePicker label="People" people={people} value={personIds} onChange={setPersonIds} exclude={[meId, ...existing.filter((r) => r.holderType === 'person').map((r) => r.holderId)]} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">Access</span>
        <div className={s.seg} role="radiogroup" aria-label="Access">
          {(['use', 'export', 'block'] as Access[]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={access === v} className={cn(s.segBtn, access === v && s.segBtnActive, v === 'block' && s.segBtnDanger)} onClick={() => setAccess(v)}>
              {ACCESS_LABEL[v]}
            </button>
          ))}
        </div>
      </div>
      {access !== 'block' ? (
        <label className="flex items-center gap-2 text-caption text-muted-foreground">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Also approve other people's requests for this data automatically (only if it is not protected)
        </label>
      ) : null}
      {protectedCols > 0 && access !== 'block' ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3">
          <label className={cn('flex items-start gap-2 text-caption', !canGrantProtected && 'opacity-60')}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={withProtected && canGrantProtected}
              disabled={!canGrantProtected}
              onChange={(e) => setWithProtected(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">
                Also give access to the {protectedCols} protected column{protectedCols === 1 ? '' : 's'} in this {kindWord}
              </span>
              <span className="mt-0.5 block text-muted-foreground">
                {belowTags.map((b) => `${tagName.get(b.tagId)} (${b.columns})`).join(' · ')}. Without this they can use the {kindWord} but see ••• in those columns.
              </span>
              {!isPlatformAdmin ? (
                <span className="mt-0.5 block text-muted-foreground">Only a platform admin can give access to protected data.</span>
              ) : kind === 'builtin' ? (
                <span className="mt-0.5 block text-muted-foreground">Built-in groups can&apos;t hold protected data. Choose a group or specific people.</span>
              ) : null}
            </span>
          </label>
          {withProtected && canGrantProtected ? (
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <span className="text-caption text-muted-foreground">They see</span>
              <div className={s.seg} role="radiogroup" aria-label="Protected column access">
                {(
                  [
                    ['full', 'Exact values'],
                    ['aggregate', 'Totals only'],
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={protLevel === v} className={cn(s.segBtn, protLevel === v && s.segBtnActive)} onClick={() => setProtLevel(v)}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-caption text-muted-foreground">No end date</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <Input className={userStyles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the audit log)" aria-label="Reason" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={userStyles.primary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Give access'}
        </button>
        <button type="button" className={userStyles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className={s.errorText} role="alert">{error}</span> : null}
      </div>
    </div>
  );
}

function ProtectPathForm({
  path,
  kindWord,
  tags,
  onCancel,
  onDone,
}: {
  path: string;
  kindWord: string;
  tags: DataTag[];
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [tagId, setTagId] = useState(tags[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (tags.length === 0) {
    return <p className="text-caption text-muted-foreground">No protections to add. Create one in the Protections tab first.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ConsoleSelect
        className={s.consoleSelectFull}
        value={tagId || tags[0]?.id || ''}
        ariaLabel="Protection"
        onChange={setTagId}
        options={tags.map((t) => ({ value: t.id, label: t.columnCount ? `${t.name} · also on ${t.columnCount} column${t.columnCount === 1 ? '' : 's'}` : t.name }))}
      />
      <p className="text-caption text-muted-foreground">
        This hides <span className="font-medium text-foreground">every column in this {kindWord}</span>, not just tagged ones. People who don&apos;t hold the protection see ••• for all of it. To hide only some columns, tag them on the Protections tab.
      </p>
      <Input className={cn(userStyles.input, s.protectCompactInput)} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason" />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={userStyles.primary}
          disabled={busy}
          onClick={async () => {
            if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
            setBusy(true);
            setError(null);
            try {
              await send('/api/access/path-protections', 'POST', { tagId, path, reason: reason.trim() });
              await onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not save');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Protect'}
        </button>
        <button type="button" className={userStyles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className={s.errorText} role="alert">{error}</span> : null}
      </div>
    </div>
  );
}

function ColumnsCard({ table, tags, readOnly, isPlatformAdmin, onChanged }: { table: string; tags: DataTag[]; readOnly: boolean; isPlatformAdmin: boolean; onChanged: () => Promise<void> }) {
  const [cols, setCols] = useState<Column[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tagId, setTagId] = useState(tags[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<{ column: string } | null>(null);

  const load = useCallback(async () => {
    const res = await accessFetch<{ columns: Column[] }>(`/api/access/data-tree/columns?table=${encodeURIComponent(table)}`);
    setCols(res.columns);
  }, [table]);
  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load columns')));
  }, [load]);

  const term = filter.trim().toLowerCase();
  const shown =
    cols?.filter((c) => !term || c.name.toLowerCase().includes(term) || (c.type?.toLowerCase().includes(term) ?? false)) ?? [];

  async function protect() {
    if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
    setError(null);
    try {
      await send('/api/access/column-tags', 'POST', { tablePath: table, columns: [...picked], tagId: tagId || tags[0]?.id, reason: reason.trim() });
      setPicked(new Set());
      setReason('');
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  return (
    <section className={s.detailPanel} aria-label="Columns">
      <div className={cn(s.detailSection, s.protectListHead, '!pb-2')}>
        <h3 className={s.detailSectionTitle}>
          Columns
          {cols ? <span className="ml-1.5 font-normal text-muted-foreground">({cols.length})</span> : null}
        </h3>
        {cols && cols.length > 8 ? (
          <div className="relative w-full min-w-0 max-w-xs sm:w-40">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              className={cn(userStyles.input, s.protectCompactInput)}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter columns"
            />
          </div>
        ) : null}
      </div>
      <div className={cn(s.detailSection, '!pt-0')}>
        {error ? <p className={cn(s.errorText, 'mb-2')}>{error}</p> : null}
        {picked.size > 0 ? (
          <div className={s.bulkProtectBar} role="region" aria-label="Apply protection to selected columns">
            <div className={s.bulkProtectMeta}>
              <span className={s.bulkProtectCount}>
                <Lock className="h-3.5 w-3.5 text-[var(--brand-a-ink)]" aria-hidden="true" />
                <span className={s.bulkProtectCountNum}>{picked.size}</span>
              </span>
              <button type="button" className={cn(s.linkBtn, 'ml-auto text-caption')} onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </div>
            <div className={s.bulkProtectActions}>
              <ConsoleSelect
                className={s.consoleSelectFull}
                value={tagId || tags[0]?.id || ''}
                ariaLabel={`Protection for ${picked.size} selected column${picked.size === 1 ? '' : 's'}`}
                placeholder="Protection"
                onChange={setTagId}
                options={tags.map((t) => ({ value: t.id, label: t.name }))}
              />
              <Input
                className={cn(userStyles.input, s.protectCompactInput, s.bulkProtectReason)}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                aria-label="Reason"
              />
              <button type="button" className={cn(s.protectCompactBtn, userStyles.primary, 'justify-self-end')} onClick={() => void protect()}>
                Apply
              </button>
            </div>
          </div>
        ) : null}
        {cols === null ? (
          <p className="text-caption text-muted-foreground">Loading…</p>
        ) : cols.length === 0 ? (
          <p className="text-caption text-muted-foreground">No harvested columns for this table.</p>
        ) : shown.length === 0 ? (
          <p className="py-4 text-center text-caption text-muted-foreground">No columns match “{filter.trim()}”.</p>
        ) : (
          <ul className={cn(s.protectColumnList, 'compact-scroll max-h-[min(45vh,420px)]')}>
            {shown.map((c) => (
              <li key={c.name}>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(s.protectColumnRow, picked.has(c.name) && s.protectColumnRowSelected)}
                  onClick={(e) => {
                    if ((e.target as Element).closest('input,button')) return;
                    setDetail({ column: c.name });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      if ((e.target as Element).closest('input,button')) return;
                      e.preventDefault();
                      setDetail({ column: c.name });
                    }
                  }}
                >
                  {!readOnly && tags.length > 0 ? (
                    <input
                      type="checkbox"
                      className="shrink-0"
                      aria-label={`Select ${c.name}`}
                      checked={picked.has(c.name)}
                      onChange={(e) =>
                        setPicked((cur) => {
                          const next = new Set(cur);
                          if (e.target.checked) next.add(c.name);
                          else next.delete(c.name);
                          return next;
                        })
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  {c.type ? <span className="hidden truncate text-caption text-muted-foreground sm:inline">{c.type}</span> : null}
                  <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {c.protections.map((p) => (
                      <span key={p.tagId} className={cn(s.chip, s.chipBrand, 'max-w-[8rem] truncate')} title={p.name}>
                        <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {p.name}
                        {!readOnly && isPlatformAdmin ? (
                          <InlineReason
                            label="×"
                            ariaLabel={`Stop protecting ${c.name} as ${p.name}`}
                            onConfirm={(reason) =>
                              send('/api/access/column-tags', 'DELETE', { tablePath: table, column: c.name, tagId: p.tagId, reason }).then(() =>
                                Promise.all([load(), onChanged()]),
                              )
                            }
                          />
                        ) : null}
                      </span>
                    ))}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {detail ? <ColumnInfoDialog table={table} column={detail.column} onClose={() => setDetail(null)} /> : null}
    </section>
  );
}

/** A small action that asks why before doing it. */
function InlineReason({ label, ariaLabel, onConfirm }: { label: string; ariaLabel?: string; onConfirm: (reason: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className={s.linkBtn} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Input className={cn(userStyles.input, 'h-7 w-40')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" aria-label="Reason" autoFocus />
      <button
        type="button"
        className={s.linkBtn}
        onClick={async () => {
          if (reason.trim().length < 5) return setError('5+ characters');
          try {
            await onConfirm(reason.trim());
            setOpen(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed');
          }
        }}
      >
        Confirm
      </button>
      <button type="button" className={s.linkBtn} aria-label="Cancel" onClick={() => setOpen(false)}>
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
      {error ? <span className={s.errorText}>{error}</span> : null}
    </span>
  );
}

