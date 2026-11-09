'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, ChevronRight, Database, Pencil, Plus, Search, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, keyFromName, runAsync, send, type AccessGroup, type Person } from './api';
import { PeoplePicker } from './GiveAccess';
import { Card, Empty, Mono, Segmented, type SegOption, SplitPane } from './parts';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

/**
 * Department map (simplified model): tag catalog → schema → table with **groups** (departments)
 * and **purpose** = how they may use it (Query / Export / Block). Writes `access_rules` via PUT /api/access/rules.
 */

type Mode = 'data' | 'department';
type Purpose = 'none' | 'use' | 'export' | 'block';

type NodeRule = {
  id: string;
  holderType: string;
  holderId: string;
  holderName: string;
  access: 'use' | 'export' | 'block';
  from: string;
};

type MapNode = {
  path: string;
  name: string;
  depth: 1 | 2 | 3;
  kind: 'catalog' | 'schema' | 'table' | 'view';
  childCount: number | null;
  tableCount: number | null;
  access: {
    rules: NodeRule[];
    inheritedRules: NodeRule[];
  };
};

const ROOT = '';
const DEPTH_NAME = ['', 'Catalog', 'Schema', 'Table'];
const PURPOSE_LABEL: Record<Exclude<Purpose, 'none'>, string> = {
  use: 'Query',
  export: 'Export',
  block: 'Block',
};
const PURPOSE_HINT: Record<Exclude<Purpose, 'none'>, string> = {
  use: 'Read and query values (Use)',
  export: 'Query and export (Use + export)',
  block: 'Deny this path and everything below',
};

function purposeOptions(includeNone = true): SegOption<Purpose>[] {
  const opts: SegOption<Purpose>[] = [
    { value: 'none', label: 'None', title: 'No rule on this path for this department' },
    { value: 'use', label: 'Query', title: PURPOSE_HINT.use },
    { value: 'export', label: 'Export', title: PURPOSE_HINT.export },
    { value: 'block', label: 'Block', tone: 'danger', title: PURPOSE_HINT.block },
  ];
  return includeNone ? opts : opts.filter((o) => o.value !== 'none');
}

type GroupTag = {
  groupId: string;
  name: string;
  access: 'use' | 'export' | 'block';
  direct: boolean;
  from: string;
};

function groupTags(node: MapNode): GroupTag[] {
  const out: GroupTag[] = [];
  const seen = new Set<string>();
  for (const r of node.access.rules) {
    if (r.holderType !== 'group') continue;
    seen.add(r.holderId);
    out.push({ groupId: r.holderId, name: r.holderName, access: r.access, direct: true, from: r.from });
  }
  for (const r of node.access.inheritedRules) {
    if (r.holderType !== 'group' || seen.has(r.holderId)) continue;
    out.push({ groupId: r.holderId, name: r.holderName, access: r.access, direct: false, from: r.from });
  }
  return out.sort((a, b) => Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name));
}

function tagText(t: GroupTag): string {
  if (t.access === 'block') return 'Blocked';
  return PURPOSE_LABEL[t.access];
}

function holderRuleOnNode(node: MapNode, groupId: string): { direct: Purpose; inherited: Purpose | null; inheritedFrom: string | null } {
  const direct = node.access.rules.find((r) => r.holderType === 'group' && r.holderId === groupId);
  const inherited = node.access.inheritedRules.find((r) => r.holderType === 'group' && r.holderId === groupId);
  return {
    direct: direct ? direct.access : 'none',
    inherited: inherited ? inherited.access : null,
    inheritedFrom: inherited?.from ?? null,
  };
}

async function putRule(groupId: string, path: string, access: Purpose, reason: string) {
  await send('/api/access/rules', 'PUT', {
    holderType: 'group',
    holderId: groupId,
    path,
    access,
    reason: reason.trim(),
  });
}

export function DepartmentMapView({
  people,
  meId,
  onChanged,
}: {
  people: Person[];
  meId: string;
  onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<Mode>('data');
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly = useConsoleReadOnly();

  const loadGroups = useCallback(async () => {
    const g = await accessFetch<{ groups: AccessGroup[] }>('/api/access/groups');
    setGroups(g.groups);
    setSelectedGroupId((cur) => cur ?? g.groups[0]?.id ?? null);
  }, []);

  useEffect(() => {
    runAsync(() => loadGroups().catch((e) => setError(e instanceof Error ? e.message : 'Could not load departments')));
  }, [loadGroups]);

  const afterChange = useCallback(async () => {
    await Promise.all([loadGroups(), onChanged()]);
  }, [loadGroups, onChanged]);

  return (
    <div>
      <div className={s.modeSwitch}>
        <p className="max-w-[72ch] text-caption text-muted-foreground">
          {mode === 'data'
            ? 'Map catalogs, schemas, and tables to departments (groups). Query = read values; Export = export too. Names are visible to everyone without a rule.'
            : 'Pick a department to see everything mapped to it, change purpose, or add more data from the tree.'}
        </p>
        <Segmented<Mode>
          ariaLabel="Map direction"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'data', label: 'Data → departments' },
            { value: 'department', label: 'Department → data' },
          ]}
        />
      </div>
      {error ? (
        <p className={cn(s.errorText, 'px-5 pt-3')} role="alert">
          {error}
        </p>
      ) : null}
      {mode === 'data' ? (
        <ByData groups={groups} readOnly={readOnly} onOpenDepartment={setSelectedGroupId} onMode={() => setMode('department')} afterChange={afterChange} />
      ) : (
        <ByDepartment
          groups={groups}
          people={people}
          meId={meId}
          selectedId={selectedGroupId}
          onSelect={setSelectedGroupId}
          readOnly={readOnly}
          afterChange={afterChange}
        />
      )}
    </div>
  );
}

/* ── Data → departments ──────────────────────────────────── */

function TagChips({
  tags,
  onOpen,
}: {
  tags: GroupTag[];
  onOpen: (groupId: string) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <span className={s.tagList}>
      {tags.map((t) => {
        const title = t.direct
          ? `${t.name}: set on this path`
          : `${t.name}: ${PURPOSE_LABEL[t.access]} from ${t.from}`;
        return (
          <button
            key={t.groupId}
            type="button"
            title={`${title}. Open ${t.name}.`}
            onClick={() => onOpen(t.groupId)}
            className={cn(s.chip, t.access === 'block' ? s.chipBad : s.chipBrand, !t.direct && s.chipFaint)}
          >
            <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            {t.name} · {tagText(t)}
            {!t.direct ? ' ↑' : ''}
          </button>
        );
      })}
    </span>
  );
}

function GroupPurposeEditor({
  node,
  groups,
  reason,
  busy,
  onSet,
}: {
  node: MapNode;
  groups: AccessGroup[];
  reason: string;
  busy: boolean;
  onSet: (groupId: string, purpose: Purpose) => void;
}) {
  const byGroup = new Map(groupTags(node).map((t) => [t.groupId, t]));
  return (
    <div className={s.tagEditor}>
      <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Departments</p>
      {groups.length === 0 ? (
        <p className="text-caption text-muted-foreground">Create a department under “Department → data”.</p>
      ) : (
        groups.map((g) => {
          const t = byGroup.get(g.id);
          const { direct, inherited } = holderRuleOnNode(node, g.id);
          const hasDirect = node.access.rules.some((r) => r.holderType === 'group' && r.holderId === g.id);
          const value: Purpose = hasDirect && direct !== 'none' ? direct : 'none';
          return (
            <div key={g.id} className={s.tagEditorRow}>
              <span>
                <span className="font-medium">{g.name}</span>
                {t && !t.direct ? (
                  <span className="block text-caption text-muted-foreground">
                    {tagText(t)} from {t.from}
                  </span>
                ) : null}
              </span>
              <Segmented<Purpose>
                ariaLabel={`${g.name} access to ${node.path}`}
                options={purposeOptions()}
                value={value}
                inherited={value === 'none' ? inherited : null}
                disabled={busy || reason.trim().length < 5}
                onChange={(v) => onSet(g.id, v)}
              />
            </div>
          );
        })
      )}
    </div>
  );
}

function ByData({
  groups,
  readOnly,
  onOpenDepartment,
  onMode,
  afterChange,
}: {
  groups: AccessGroup[];
  readOnly: boolean;
  onOpenDepartment: (id: string) => void;
  onMode: () => void;
  afterChange: () => Promise<void>;
}) {
  const [children, setChildren] = useState<Record<string, MapNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MapNode[] | null>(null);

  const loadLevel = useCallback(async (parent: string) => {
    const res = await accessFetch<{ nodes: MapNode[] }>(`/api/access/data-tree${parent ? `?parent=${encodeURIComponent(parent)}` : ''}`);
    setChildren((cur) => ({ ...cur, [parent]: res.nodes }));
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([ROOT, ...expanded].map((p) => loadLevel(p)));
    if (results && q.trim().length >= 2) {
      const res = await accessFetch<{ nodes: MapNode[] }>(`/api/access/data-tree?q=${encodeURIComponent(q.trim())}`);
      setResults(res.nodes);
    }
  }, [expanded, loadLevel, q, results]);

  useEffect(() => {
    runAsync(() => loadLevel(ROOT).catch((e) => setError(e instanceof Error ? e.message : 'Could not load estate')));
  }, [loadLevel]);

  async function toggleNode(node: MapNode) {
    const next = new Set(expanded);
    if (next.has(node.path)) next.delete(node.path);
    else {
      next.add(node.path);
      if (!children[node.path]) await loadLevel(node.path).catch((e) => setError(e instanceof Error ? e.message : 'Could not load'));
    }
    setExpanded(next);
  }

  async function search() {
    const term = q.trim();
    if (term.length < 2) return;
    try {
      const res = await accessFetch<{ nodes: MapNode[] }>(`/api/access/data-tree?q=${encodeURIComponent(term)}`);
      setResults(res.nodes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    }
  }

  async function setPurpose(node: MapNode, groupId: string, purpose: Purpose, reason: string) {
    setBusy(true);
    setError(null);
    try {
      await putRule(groupId, node.path, purpose, reason);
      await Promise.all([reloadAll(), afterChange()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  function renderRow(node: MapNode, level: number, flat?: boolean) {
    const tags = groupTags(node);
    const canExpand = !flat && node.depth < 3 && (node.childCount ?? 0) > 0;
    const open = expanded.has(node.path);
    const meta =
      node.depth === 1 && node.childCount !== null
        ? `${node.childCount} schema${node.childCount === 1 ? '' : 's'} · ${node.tableCount ?? 0} tables`
        : node.depth === 2 && node.tableCount !== null
          ? `${node.tableCount} table${node.tableCount === 1 ? '' : 's'}`
          : null;
    return (
      <Fragment key={node.path}>
        <div className={s.treeRow}>
          <div className={s.treeName} style={{ paddingLeft: level * 14 }}>
            <button
              type="button"
              className={s.treeToggle}
              aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
              aria-expanded={canExpand ? open : undefined}
              disabled={!canExpand || flat}
              onClick={() => void toggleNode(node)}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
            </button>
            {node.depth === 3 ? <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className={s.treeLabel} title={node.path}>
              {flat && node.depth === 3 ? node.path : node.name}
            </span>
            {meta ? <span className="text-caption text-muted-foreground">{meta}</span> : null}
          </div>
          <div className={cn(s.treeRight, 'flex-wrap')}>
            <TagChips
              tags={tags}
              onOpen={(id) => {
                onOpenDepartment(id);
                onMode();
              }}
            />
            {readOnly ? null : (
              <TagPopover node={node} groups={groups} busy={busy} onSave={(gid, p, r) => setPurpose(node, gid, p, r)} />
            )}
          </div>
        </div>
        {open && !flat ? (children[node.path] ?? []).map((c) => renderRow(c, level + 1)) : null}
      </Fragment>
    );
  }

  const roots = children[ROOT];

  return (
    <div className="p-5">
      <p className="mb-3 text-caption text-muted-foreground">
        {readOnly ? (
          'View only: departments tagged on each path.'
        ) : (
          <>
            Use <strong>Tag</strong> or <strong>Edit</strong> on a row. Purpose <strong>Query</strong> = use data;{' '}
            <strong>Export</strong> = export allowed. Need a department?{' '}
            <button type="button" className={s.linkBtn} onClick={onMode}>
              Create one
            </button>
            .
          </>
        )}
      </p>
      {error ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}
      <div className={cn(s.protectToolbar, 'mb-3')}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className={cn(userStyles.input, s.protectCompactInput)}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder="Find tables…"
            aria-label="Find tables"
          />
        </div>
        <button type="button" className={cn(s.linkBtn, s.protectCompactBtn)} onClick={() => void search()}>
          Search
        </button>
        {results ? (
          <button type="button" className={cn(s.linkBtn, s.protectCompactBtn)} onClick={() => setResults(null)}>
            Clear
          </button>
        ) : null}
      </div>
      {results ? (
        <div className={s.treeBrowse}>{results.length ? results.map((n) => renderRow(n, 0, true)) : <p className="text-caption text-muted-foreground">No matches.</p>}</div>
      ) : !roots ? (
        <p className="text-caption text-muted-foreground">Loading…</p>
      ) : (
        <div className={s.treeBrowse}>{roots.map((n) => renderRow(n, 0))}</div>
      )}
    </div>
  );
}

function TagPopover({
  node,
  groups,
  busy,
  onSave,
}: {
  node: MapNode;
  groups: AccessGroup[];
  busy: boolean;
  onSave: (groupId: string, purpose: Purpose, reason: string) => void | Promise<void>;
}) {
  const hasDirect = node.access.rules.some((r) => r.holderType === 'group');
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={s.tagBtn} aria-label={`Tag departments for ${node.path}`}>
          {hasDirect ? <Pencil className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {hasDirect ? 'Edit' : 'Tag'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={cn(userStyles.surface, '!w-[540px] max-w-[calc(100vw-32px)] z-[100]')}>
        <p className="mb-1 text-size-ui font-semibold">Departments for this {DEPTH_NAME[node.depth].toLowerCase()}</p>
        <p className="mb-2 break-all text-caption text-muted-foreground">
          <Mono>{node.path}</Mono>
          {node.depth < 3 ? ' and everything inside' : ''}
        </p>
        <label className="mb-2 block text-caption text-muted-foreground" htmlFor={`map-reason-${node.path}`}>
          Reason for changes (audit log, min 5 characters)
        </label>
        <Input
          id={`map-reason-${node.path}`}
          className={cn(userStyles.input, 'mb-3')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this mapping"
        />
        <GroupPurposeEditor
          node={node}
          groups={groups}
          reason={reason}
          busy={busy}
          onSet={(gid, purpose) => {
            if (reason.trim().length < 5) return;
            void Promise.resolve(onSave(gid, purpose, reason)).then(() => setOpen(false));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ── Department → data ───────────────────────────────────── */

function ByDepartment({
  groups,
  people,
  meId,
  selectedId,
  onSelect,
  readOnly,
  afterChange,
}: {
  groups: AccessGroup[];
  people: Person[];
  meId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  readOnly: boolean;
  afterChange: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [approver, setApprover] = useState<string[]>([]);
  const [createReason, setCreateReason] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = groups.find((g) => g.id === selectedId) ?? groups[0] ?? null;
  const [ruleCounts, setRuleCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (groups.length === 0) return;
    runAsync(() =>
      accessFetch<{ rules: { holderId: string }[] }>('/api/access/rules?holderType=group')
        .then((r) => {
          const c: Record<string, number> = {};
          for (const rule of r.rules) c[rule.holderId] = (c[rule.holderId] ?? 0) + 1;
          setRuleCounts(c);
        })
        .catch(() => setRuleCounts({})),
    );
  }, [groups]);

  async function create() {
    if (createReason.trim().length < 5) {
      setCreateError('Give a reason (at least 5 characters)');
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const res = await send<{ group: { id: string } }>('/api/access/groups', 'POST', {
        key: keyFromName(name),
        name: name.trim(),
        ownerIds: approver[0] ? [approver[0]] : [],
        reason: createReason.trim(),
      });
      setName('');
      setCreateReason('');
      setCreating(false);
      await afterChange();
      onSelect(res.group.id);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create department');
    } finally {
      setBusy(false);
    }
  }

  const listItem = (g: AccessGroup, ruleCount: number) => {
    const active = current?.id === g.id;
    return (
      <button key={g.id} type="button" className={cn(s.listItem, active && s.listItemActive)} onClick={() => onSelect(g.id)} aria-current={active}>
        <span className={s.listItemTitle}>
          <span className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            {g.name}
          </span>
          <span className={cn(s.chip, ruleCount ? s.chipBrand : '')}>{ruleCount} mapped</span>
        </span>
        <span className={s.listItemSub}>
          {g.members.filter((m) => !m.expired).length} people · assign more on People &amp; groups
        </span>
      </button>
    );
  };

  return (
    <SplitPane>
      <aside className={s.listPane} aria-label="Departments">
        <div className={s.listBody}>
          <div className="flex items-center justify-between px-3 pb-1 pt-2">
            <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Departments</p>
            {readOnly ? null : (
              <button type="button" className={cn(s.linkBtn, 'inline-flex items-center gap-1')} onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
                <Plus className="h-3 w-3" /> New
              </button>
            )}
          </div>
          {creating && !readOnly ? (
            <div className={cn(s.inlineForm, 'mx-1 mb-2')}>
              <label className="text-caption text-muted-foreground" htmlFor="dept-map-name">
                Name
              </label>
              <Input id="dept-map-name" className={userStyles.input} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Marine" />
              <PeoplePicker label="Approver" single people={people} value={approver} onChange={setApprover} exclude={[meId]} placeholder="Who approves joining" />
              <Input className={userStyles.input} value={createReason} onChange={(e) => setCreateReason(e.target.value)} placeholder="Reason (audit log)" aria-label="Reason" />
              {createError ? <p className={s.errorText}>{createError}</p> : null}
              <div className={s.rowActions}>
                <Button type="button" className={userStyles.primary} disabled={busy || name.trim().length < 2} onClick={() => void create()}>
                  {busy ? 'Creating…' : 'Create'}
                </Button>
                <Button type="button" variant="outline" className={userStyles.secondaryButton} onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {groups.length === 0 ? (
            <p className="px-3 py-2 text-caption text-muted-foreground">No departments yet. A department is a team that uses the same data.</p>
          ) : (
            groups.map((g) => listItem(g, ruleCounts[g.id] ?? 0))
          )}
        </div>
      </aside>
      <div className={s.detailPane}>
        {!current ? (
          <Empty icon={<Building2 className="h-8 w-8 opacity-40" />}>Create a department to start mapping data.</Empty>
        ) : (
          <DepartmentData key={current.id} group={current} readOnly={readOnly} afterChange={afterChange} />
        )}
      </div>
    </SplitPane>
  );
}

function DepartmentData({
  group,
  readOnly,
  afterChange,
}: {
  group: AccessGroup;
  readOnly: boolean;
  afterChange: () => Promise<void>;
}) {
  const [rules, setRules] = useState<{ id: string; path: string; access: 'use' | 'export' | 'block' }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changeReason, setChangeReason] = useState('');

  const loadRules = useCallback(async () => {
    const r = await accessFetch<{ rules: { id: string; path: string; access: 'use' | 'export' | 'block' }[] }>(
      `/api/access/rules?holderType=group&holderId=${encodeURIComponent(group.id)}`,
    );
    setRules(r.rules);
  }, [group.id]);

  useEffect(() => {
    runAsync(() => loadRules().catch((e) => setError(e instanceof Error ? e.message : 'Could not load rules')));
  }, [loadRules]);

  const refresh = async () => {
    await Promise.all([loadRules(), afterChange()]);
  };

  async function change(path: string, purpose: Purpose, reloadTree?: () => Promise<void>) {
    if (changeReason.trim().length < 5) {
      setError('Set a reason below (at least 5 characters) before changing access');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putRule(group.id, path, purpose, changeReason);
      await refresh();
      if (reloadTree) await reloadTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...(rules ?? [])].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <>
      <div className={s.detailHead}>
        <div>
          <h2 className="flex items-center gap-2 text-title-card">
            <Building2 className="h-4 w-4" aria-hidden="true" /> {group.name}
          </h2>
          <p className={s.summaryLine}>
            {sorted.length} mapped path{sorted.length === 1 ? '' : 's'} · {group.members.filter((m) => !m.expired).length} people
          </p>
        </div>
      </div>
      {!readOnly ? (
        <div className="mb-3">
          <label className="text-caption text-muted-foreground" htmlFor="dept-change-reason">
            Reason for changes on this page
          </label>
          <Input
            id="dept-change-reason"
            className={userStyles.input}
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            placeholder="Audit log (min 5 characters)"
          />
        </div>
      ) : null}
      {error ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}
      <Card title={`Mapped to ${group.name}`} hint="A catalog or schema covers every table inside it.">
        {rules === null ? (
          <p className="text-caption text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-caption text-muted-foreground">Nothing mapped yet. Add data from the tree below.</p>
        ) : (
          <ul className="flex flex-col">
            {sorted.map((r) => (
              <li key={r.id} className={s.tagEditorRow}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={s.chip}>{DEPTH_NAME[r.path.split('.').length]}</span>
                  <Mono>{r.path}</Mono>
                </span>
                <span className="flex items-center gap-2">
                  <Segmented<Purpose>
                    ariaLabel={`${group.name} access to ${r.path}`}
                    options={purposeOptions(false)}
                    value={r.access}
                    disabled={busy || readOnly}
                    onChange={(v) => void change(r.path, v)}
                  />
                  {readOnly ? null : (
                    <button type="button" className={s.linkBtn} disabled={busy} onClick={() => void change(r.path, 'none')}>
                      Remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="mt-[14px]" title={readOnly ? 'Data by catalog' : 'Add or change data'} hint="Pick purpose on any row. Dashed = inherited from a parent.">
        <DepartmentTree groupId={group.id} readOnly={readOnly} busy={busy} changeReason={changeReason} onChange={(path, purpose, reload) => void change(path, purpose, reload)} />
      </Card>
    </>
  );
}

function DepartmentTree({
  groupId,
  readOnly,
  busy,
  changeReason,
  onChange,
}: {
  groupId: string;
  readOnly: boolean;
  busy: boolean;
  changeReason: string;
  onChange: (path: string, purpose: Purpose, reload: () => Promise<void>) => void;
}) {
  const [children, setChildren] = useState<Record<string, MapNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const loadLevel = useCallback(async (parent: string) => {
    const res = await accessFetch<{ nodes: MapNode[] }>(`/api/access/data-tree${parent ? `?parent=${encodeURIComponent(parent)}` : ''}`);
    setChildren((cur) => ({ ...cur, [parent]: res.nodes }));
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([ROOT, ...expanded].map((p) => loadLevel(p)));
  }, [expanded, loadLevel]);

  useEffect(() => {
    runAsync(() => loadLevel(ROOT).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')));
  }, [loadLevel]);

  async function toggle(path: string, depth: number) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!children[path]) await loadLevel(path);
    }
    setExpanded(next);
  }

  function render(parent: string, level: number): ReactNode {
    const list = children[parent];
    if (!list) return null;
    return list.map((node) => {
      const { direct, inherited, inheritedFrom } = holderRuleOnNode(node, groupId);
      const value: Purpose = direct !== 'none' ? direct : 'none';
      const open = expanded.has(node.path);
      const canExpand = node.depth < 3 && (node.childCount ?? 0) > 0;
      return (
        <Fragment key={node.path}>
          <div className={s.treeRow}>
            <div className={s.treeName} style={{ paddingLeft: level * 14 }}>
              <button type="button" className={s.treeToggle} disabled={!canExpand} onClick={() => void toggle(node.path, node.depth)}>
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
              </button>
              <span className={s.treeLabel}>{node.name}</span>
            </div>
            <div className={s.treeRight}>
              {inherited && value === 'none' ? <span className="text-caption text-muted-foreground">from {inheritedFrom}</span> : null}
              {readOnly ? (
                <span className={s.chip}>{value === 'none' ? (inherited ? PURPOSE_LABEL[inherited] : '—') : PURPOSE_LABEL[value as 'use' | 'export' | 'block']}</span>
              ) : (
                <Segmented<Purpose>
                  ariaLabel={`Access to ${node.path}`}
                  options={purposeOptions()}
                  value={value}
                  inherited={value === 'none' ? inherited : null}
                  disabled={busy || changeReason.trim().length < 5}
                  onChange={(v) => onChange(node.path, v, reload)}
                />
              )}
            </div>
          </div>
          {open ? render(node.path, level + 1) : null}
        </Fragment>
      );
    });
  }

  return (
    <div>
      {error ? <p className={s.errorText}>{error}</p> : null}
      {!children[ROOT] ? <p className="text-caption text-muted-foreground">Loading…</p> : <div className={s.treeBrowse}>{render(ROOT, 0)}</div>}
    </div>
  );
}
