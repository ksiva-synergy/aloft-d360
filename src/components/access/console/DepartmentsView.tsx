'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, ChevronRight, Database, Plus, Table2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, keyFromName, runAsync, send, type AccessGroup } from './api';
import { Card, ConfirmButton, Empty, Mono, SplitPane } from './parts';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

/**
 * Departments tab: ONLY which data belongs to each department (Marine, QHSE). A table can belong to several.
 * Who may use that data is set on the People & groups tab (a group links to departments there).
 * Writes access_data_departments / access_department_paths.
 */

export type Department = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  paths: { id: string; path: string; depth: number }[];
  groups: { groupId: string; allowExport: boolean }[];
};

type TreeNode = { path: string; name: string; depth: 1 | 2 | 3; kind: string; childCount: number | null };

const ROOT = '';
const DEPTH_NAME: Record<number, string> = { 1: 'Catalog', 2: 'Schema', 3: 'Table' };

export function DepartmentsView() {
  const readOnly = useConsoleReadOnly();
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, g] = await Promise.all([
      accessFetch<{ departments: Department[] }>('/api/access/data-departments'),
      accessFetch<{ groups: AccessGroup[] }>('/api/access/groups'),
    ]);
    setDepartments(d.departments);
    setGroups(g.groups);
    setSelectedId((cur) => (cur && d.departments.some((x) => x.id === cur) ? cur : (d.departments[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load departments')));
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await send<{ department: { id: string } }>('/api/access/data-departments', 'POST', {
        key: keyFromName(name),
        name: name.trim(),
      });
      setName('');
      setCreating(false);
      await load();
      setSelectedId(res.department.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create department');
    } finally {
      setBusy(false);
    }
  }

  const current = departments?.find((d) => d.id === selectedId) ?? null;

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
              <label className="text-caption text-muted-foreground" htmlFor="department-name">
                Department name
              </label>
              <Input id="department-name" className={userStyles.input} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Marine" />
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
          {departments === null ? (
            <p className="px-3 py-2 text-caption text-muted-foreground">Loading…</p>
          ) : departments.length === 0 ? (
            <p className="px-3 py-2 text-caption text-muted-foreground">No departments yet. A department owns tables, like Marine or QHSE.</p>
          ) : (
            departments.map((d) => (
              <button key={d.id} type="button" className={cn(s.listItem, d.id === current?.id && s.listItemActive)} onClick={() => setSelectedId(d.id)} aria-current={d.id === current?.id}>
                <span className={s.listItemTitle}>
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {d.name}
                  </span>
                </span>
                <span className={s.listItemSub}>
                  {d.paths.length} item{d.paths.length === 1 ? '' : 's'}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
      <div className={s.detailPane}>
        {error ? (
          <p className={cn(s.errorText, 'mb-3')} role="alert">
            {error}
          </p>
        ) : null}
        {!current ? (
          <Empty icon={<Building2 className="h-8 w-8 opacity-40" />}>Create a department, then add the tables it owns.</Empty>
        ) : (
          <DepartmentDetail key={current.id} department={current} groups={groups} readOnly={readOnly} onChanged={load} />
        )}
      </div>
    </SplitPane>
  );
}

function DepartmentDetail({ department, groups, readOnly, onChanged }: { department: Department; groups: AccessGroup[]; readOnly: boolean; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const addPath = (path: string) => run(() => send('/api/access/department-paths', 'POST', { departmentId: department.id, path }));
  const removePath = (path: string) => run(() => send('/api/access/department-paths', 'DELETE', { departmentId: department.id, path }));

  const usedBy = department.groups.map((l) => groups.find((g) => g.id === l.groupId)?.name).filter((n): n is string => !!n);

  return (
    <div className={s.deptCompact}>
      <div className={s.detailHead}>
        <div>
          <h2 className="flex items-center gap-2 text-title-card">
            <Building2 className="h-4 w-4" aria-hidden="true" /> {department.name}
          </h2>
          <p className={s.summaryLine}>
            {department.paths.length} item{department.paths.length === 1 ? '' : 's'} belong here ·{' '}
            {usedBy.length ? `used by ${usedBy.join(', ')}` : 'no group uses it yet'}
            {' '}(set on People &amp; groups)
          </p>
        </div>
        {readOnly ? null : (
          <button type="button" className={cn(s.protectCompactBtn, userStyles.primary)} onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add data
          </button>
        )}
      </div>
      {error && !adding ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}

      <Card title={`Data that belongs to ${department.name}`} hint="A catalog or schema covers every table inside it.">
        {department.paths.length === 0 ? (
          <p className="text-caption text-muted-foreground">Nothing yet. Use Add data to tag the tables it owns.</p>
        ) : (
          <ul className="flex flex-col">
            {department.paths.map((p) => (
              <li key={p.id} className={s.tagEditorRow}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={s.chip}>{DEPTH_NAME[p.depth]}</span>
                  <Mono>{p.path}</Mono>
                </span>
                {readOnly ? null : (
                  <ConfirmButton label="Remove" ariaLabel={`Remove ${p.path}`} disabled={busy} onConfirm={() => removePath(p.path)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {readOnly ? null : (
        <Dialog open={adding} onOpenChange={setAdding}>
          {/* The dialog renders outside the page, so it needs the users surface for button and input styles. */}
          <DialogContent className={cn(userStyles.surface, 'max-w-2xl overflow-x-hidden')}>
            <div role="dialog" aria-modal="true" aria-label={`Add data to ${department.name}`}>
              <div className="mb-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-title-card">Add data to {department.name}</h2>
                  <p className="mt-1 text-caption text-muted-foreground">Add a catalog or schema to cover everything inside it, or pick single tables.</p>
                </div>
                <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={() => setAdding(false)}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              {error ? (
                <p className={cn(s.errorText, 'mb-2')} role="alert">
                  {error}
                </p>
              ) : null}
              <div className="max-h-[50vh] overflow-y-auto">
                <AddDataTree owned={department.paths.map((p) => p.path)} busy={busy} onAdd={(path) => void addPath(path)} />
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" className={userStyles.secondaryButton} onClick={() => setAdding(false)}>
                  Done
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Walk catalog → schema → table; each row can be added unless it (or a parent) already belongs. */
function AddDataTree({ owned, busy, onAdd }: { owned: string[]; busy: boolean; onAdd: (path: string) => void }) {
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const ownedSet = useMemo(() => new Set(owned.map((p) => p.toLowerCase())), [owned]);

  const loadLevel = useCallback(async (parent: string) => {
    const res = await accessFetch<{ nodes: TreeNode[] }>(`/api/access/data-tree${parent ? `?parent=${encodeURIComponent(parent)}` : ''}`);
    setChildren((cur) => ({ ...cur, [parent]: res.nodes }));
  }, []);

  useEffect(() => {
    runAsync(() => loadLevel(ROOT).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')));
  }, [loadLevel]);

  async function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!children[path]) await loadLevel(path);
    }
    setExpanded(next);
  }

  function viaParent(path: string): string | null {
    const parts = path.toLowerCase().split('.');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('.');
      if (ownedSet.has(parent)) return parent;
    }
    return null;
  }

  function render(parent: string, level: number): ReactNode {
    const list = children[parent];
    if (!list) return null;
    return list.map((node) => {
      const open = expanded.has(node.path);
      const canExpand = node.depth < 3 && (node.childCount ?? 0) > 0;
      const direct = ownedSet.has(node.path.toLowerCase());
      const via = direct ? null : viaParent(node.path);
      return (
        <Fragment key={node.path}>
          <div className={s.treeRow}>
            <div className={s.treeName} style={{ paddingLeft: level * 14 }}>
              <button type="button" className={s.treeToggle} disabled={!canExpand} aria-label={`Open ${node.name}`} onClick={() => void toggle(node.path)}>
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
              </button>
              {node.depth === 3 ? <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className={s.treeLabel}>{node.name}</span>
            </div>
            <div className={s.treeRight}>
              {direct ? (
                <span className={cn(s.chip, s.chipOk)}>Belongs</span>
              ) : via ? (
                <span className="text-caption text-muted-foreground">via {via}</span>
              ) : (
                <button type="button" className={cn(s.protectCompactBtn, userStyles.secondaryButton)} disabled={busy} aria-label={`Add ${node.path}`} onClick={() => onAdd(node.path)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add
                </button>
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
