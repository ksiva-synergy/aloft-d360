'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Lock, Pencil, Plus, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import userStyles from '@/components/users/users.module.css';
import {
  LEVEL_HINT,
  LEVEL_LABEL,
  SENSITIVITY_LABEL,
  accessFetch,
  buildHolders,
  holderKey,
  runAsync,
  send,
  type Department,
  type Grant,
  type Holder,
  type Level,
  type PathTag,
  type RoleInfo,
  type TreeNode,
} from './api';
import { EstateTree, type TreeContext } from './EstateTree';
import { Card, Empty, Mono, Segmented, type SegOption, SplitPane } from './parts';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

type Mode = 'data' | 'holder';
type Choice = 'none' | Level | 'deny';

const LEVEL_RANK: Record<Level, number> = { discover: 1, query: 2, export: 3 };
const DEPTH_NAME = ['', 'Catalog', 'Schema', 'Table'];
const LOCK_TITLE = 'Labelled data: only a platform admin can open it';

/** Level options; allow levels are locked on labelled paths for non-platform admins. */
function choices(locked: boolean, includeNone = true): SegOption<Choice>[] {
  const opts: SegOption<Choice>[] = [
    { value: 'none', label: 'None', title: 'Not set on this path' },
    { value: 'discover', label: 'Discover', title: locked ? LOCK_TITLE : LEVEL_HINT.discover, disabled: locked },
    { value: 'query', label: 'Query', title: locked ? LOCK_TITLE : LEVEL_HINT.query, disabled: locked },
    { value: 'export', label: 'Export', title: locked ? LOCK_TITLE : LEVEL_HINT.export, disabled: locked },
    {
      value: 'deny',
      label: 'Block',
      tone: 'danger',
      title: 'Deny this path and everything below it, even if granted elsewhere',
    },
  ];
  return includeNone ? opts : opts.filter((o) => o.value !== 'none');
}

function putLevel(h: { type: 'department' | 'role'; id: string }, path: string, level: Choice) {
  return send('/api/access/grants/level', 'PUT', {
    principalType: h.type,
    principalId: h.id,
    path,
    level,
  });
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'd_$1')
    .slice(0, 64);
}

function HolderIcon({ h }: { h: Holder }) {
  if (h.type === 'role') return <UserCog className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  return <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}

export function DataMapView({
  departments,
  roles,
  isPlatformAdmin,
  onChanged,
}: {
  departments: Department[];
  roles: RoleInfo[];
  isPlatformAdmin: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<Mode>('data');
  const [grants, setGrants] = useState<Grant[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holders = useMemo(() => buildHolders(departments, roles), [departments, roles]);

  const loadGrants = useCallback(async () => {
    try {
      const data = await accessFetch<{ grants: Grant[] }>('/api/access/grants');
      setGrants(data.grants);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load grants');
    }
  }, []);

  useEffect(() => {
    runAsync(loadGrants);
  }, [loadGrants]);

  const afterChange = useCallback(async () => {
    await Promise.all([loadGrants(), onChanged()]);
  }, [loadGrants, onChanged]);

  const openHolder = (key: string) => {
    setSelectedKey(key);
    setMode('holder');
  };

  return (
    <div>
      <div className={s.modeSwitch}>
        <p className="max-w-[72ch] text-caption text-muted-foreground">
          {mode === 'data'
            ? 'Tag catalogs, schemas, or tables with the app roles and departments that may use them. A tag on a catalog or schema covers everything inside. A path can carry any number of tags.'
            : 'Pick an app role or a department to see everything mapped to it, change levels, or add more data.'}
          {!isPlatformAdmin ? ' Confidential and Restricted data can only be opened by a platform admin.' : ''}
        </p>
        <Segmented<Mode>
          ariaLabel="Map direction"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'data', label: 'Data → roles & departments' },
            { value: 'holder', label: 'Role or department → data' },
          ]}
        />
      </div>
      {error ? (
        <p className={cn(s.errorText, 'px-5 pt-3')} role="alert">
          {error}
        </p>
      ) : null}
      {mode === 'data' ? (
        <ByData
          holders={holders}
          allHolders={holders}
          isPlatformAdmin={isPlatformAdmin}
          afterChange={afterChange}
          onOpenHolder={openHolder}
        />
      ) : (
        <ByHolder
          holders={holders}
          grants={grants}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          isPlatformAdmin={isPlatformAdmin}
          afterChange={afterChange}
        />
      )}
    </div>
  );
}

/* ── Data → roles & departments ──────────────────────────── */

function tagText(t: PathTag): string {
  if (t.deny) return 'Blocked';
  if (t.level) return LEVEL_LABEL[t.level];
  return `${t.inside} inside`;
}

function TagChips({
  tags,
  byKey,
  onOpen,
}: {
  tags: PathTag[];
  byKey: Map<string, Holder>;
  onOpen: (key: string) => void;
}) {
  const name = (t: PathTag) => byKey.get(holderKey(t.principalType, t.principalId))?.name ?? 'Archived';
  const sorted = [...tags].sort(
    (a, b) =>
      Number(b.direct) - Number(a.direct) ||
      Number(b.principalType === 'role') - Number(a.principalType === 'role') ||
      name(a).localeCompare(name(b)),
  );
  return (
    <span className={s.tagList}>
      {sorted.map((t) => {
        const key = holderKey(t.principalType, t.principalId);
        const n = name(t);
        const title = t.direct
          ? `${n}: set on this path`
          : t.from
            ? `${n}: inherited from ${t.from}`
            : `${n}: set on ${t.inside} path${t.inside === 1 ? '' : 's'} inside`;
        return (
          <button
            key={key}
            type="button"
            title={`${title}. Open ${n}.`}
            onClick={() => onOpen(key)}
            className={cn(s.chip, t.deny ? s.chipBad : t.level ? s.chipBrand : '', !t.direct && s.chipFaint)}
          >
            {t.principalType === 'role' ? <UserCog className="h-3 w-3" aria-hidden="true" /> : null}
            {n} · {tagText(t)}
            {!t.direct && t.from ? ' ↑' : ''}
          </button>
        );
      })}
    </span>
  );
}

function TagEditor({
  node,
  holders,
  locked,
  onSet,
  busy,
}: {
  node: TreeNode;
  holders: Holder[];
  locked: boolean;
  onSet: (h: Holder, level: Choice) => void;
  busy: boolean;
}) {
  const byKey = new Map((node.tags ?? []).map((t) => [holderKey(t.principalType, t.principalId), t]));
  const groups: { title: string; items: Holder[] }[] = [
    { title: 'App roles', items: holders.filter((h) => h.type === 'role') },
    { title: 'Departments', items: holders.filter((h) => h.type === 'department') },
  ];
  return (
    <div className={s.tagEditor}>
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <div key={g.title}>
            <p className="mt-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>
            {g.items.map((h) => {
              const t = byKey.get(holderKey(h.type, h.id));
              const value: Choice = t?.direct ? (t.deny ? 'deny' : (t.level ?? 'none')) : 'none';
              const inherited: Choice | null = t && !t.direct ? (t.deny ? 'deny' : t.level) : null;
              return (
                <div key={h.id} className={s.tagEditorRow}>
                  <span>
                    <span className="font-medium">{h.name}</span>
                    {t && !t.direct && t.from ? (
                      <span className="block text-caption text-muted-foreground">
                        {t.deny ? 'Blocked' : LEVEL_LABEL[t.level!]} from {t.from}
                      </span>
                    ) : null}
                  </span>
                  <Segmented<Choice>
                    ariaLabel={`${h.name} access to ${node.path}`}
                    options={choices(locked)}
                    value={value}
                    inherited={value === 'none' ? inherited : null}
                    disabled={busy}
                    onChange={(v) => onSet(h, v)}
                  />
                </div>
              );
            })}
          </div>
        ),
      )}
    </div>
  );
}

function ByData({
  holders,
  allHolders,
  isPlatformAdmin,
  afterChange,
  onOpenHolder,
}: {
  holders: Holder[];
  allHolders: Holder[];
  isPlatformAdmin: boolean;
  afterChange: () => Promise<void>;
  onOpenHolder: (key: string) => void;
}) {
  const byKey = useMemo(() => new Map(allHolders.map((h) => [holderKey(h.type, h.id), h])), [allHolders]);
  const [selected, setSelected] = useState<Map<string, TreeNode>>(new Map());
  const [bulkHolders, setBulkHolders] = useState<Set<string>>(new Set());
  const [bulkLevel, setBulkLevel] = useState<Choice>('query');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);

  const isLocked = (node: TreeNode) => !isPlatformAdmin && node.label.label !== 'internal';
  const readOnly = useConsoleReadOnly();

  async function setOne(node: TreeNode, h: Holder, level: Choice, ctx: TreeContext) {
    setBusy(true);
    setError(null);
    try {
      await putLevel(h, node.path, level);
      await Promise.all([ctx.reload(), afterChange()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the tag');
    } finally {
      setBusy(false);
    }
  }

  async function applyBulk() {
    const opening = bulkLevel === 'discover' || bulkLevel === 'query' || bulkLevel === 'export';
    const lockedPaths = [...selected.values()].filter((n) => opening && isLocked(n)).map((n) => n.path);
    if (lockedPaths.length) {
      setError(`Only a platform admin can open labelled data: ${lockedPaths.join(', ')}. Untick these and try again.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const targets = [...bulkHolders].map((k) => byKey.get(k)).filter(Boolean) as Holder[];
      for (const path of selected.keys()) {
        await Promise.all(targets.map((h) => putLevel(h, path, bulkLevel)));
      }
      setSelected(new Map());
      await afterChange();
      setTreeKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply tags');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5">
      {selected.size > 0 ? (
        <div className={s.bulkBar} role="region" aria-label="Tag selected paths">
          <strong>{selected.size} selected</strong>
          <span className="text-muted-foreground">Tag with:</span>
          {holders.map((h) => {
            const key = holderKey(h.type, h.id);
            return (
              <button
                key={key}
                type="button"
                className={s.deptToggle}
                aria-pressed={bulkHolders.has(key)}
                title={h.sub}
                onClick={() =>
                  setBulkHolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                {h.type === 'role' ? <UserCog className="mr-1 inline h-3 w-3" aria-hidden="true" /> : null}
                {h.name}
              </button>
            );
          })}
          <Segmented<Choice>
            ariaLabel="Level for selected paths"
            options={[
              ...choices(false, false).filter((o) => o.value !== 'deny'),
              { value: 'deny', label: 'Block', tone: 'danger' },
              { value: 'none', label: 'Untag', title: 'Remove these tags from the selected paths' },
            ]}
            value={bulkLevel}
            onChange={setBulkLevel}
          />
          <span className="ml-auto flex gap-2">
            <Button
              type="button"
              className={userStyles.primary}
              disabled={busy || bulkHolders.size === 0}
              onClick={() => void applyBulk()}
            >
              {busy ? 'Applying…' : 'Apply'}
            </Button>
            <Button type="button" variant="outline" className={userStyles.secondaryButton} onClick={() => setSelected(new Map())}>
              Clear
            </Button>
          </span>
        </div>
      ) : (
        <p className="mb-3 text-caption text-muted-foreground">
          {readOnly ? (
            'View only: these are the roles and departments tagged on each catalog, schema, and table.'
          ) : (
            <>
              Tick several catalogs, schemas, or tables to tag them at once, or use <strong>Edit</strong> on a row.
              {holders.every((h) => h.type === 'role') ? ' Create departments under “Role or department → data”.' : ''}
            </>
          )}
        </p>
      )}
      {error ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}
      <EstateTree
        tags
        rightTitle="Roles & departments"
        refreshKey={treeKey}
        selected={new Set(selected.keys())}
        onToggleSelect={readOnly ? undefined : (node, on) =>
          setSelected((prev) => {
            const next = new Map(prev);
            if (on) next.set(node.path, node);
            else next.delete(node.path);
            return next;
          })
        }
        renderRight={(node, ctx) => {
          const hasDirect = (node.tags ?? []).some((t) => t.direct);
          const locked = isLocked(node);
          return (
            <>
              <TagChips tags={node.tags ?? []} byKey={byKey} onOpen={onOpenHolder} />
              {locked ? (
                <span className={s.chip} title={LOCK_TITLE}>
                  <Lock className="h-3 w-3" /> Platform admin
                </span>
              ) : null}
              {readOnly ? null : (
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className={s.tagBtn} aria-label={`Edit roles and departments for ${node.path}`}>
                    {hasDirect ? <Pencil className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {hasDirect ? 'Edit' : 'Tag'}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className={cn(userStyles.surface, '!w-[540px] max-w-[calc(100vw-32px)] z-[100]')}>
                  <p className="mb-1 text-size-ui font-semibold">Who can use this {DEPTH_NAME[node.depth].toLowerCase()}</p>
                  <p className="mb-2 break-all text-caption text-muted-foreground">
                    <Mono>{node.path}</Mono>
                    {node.depth < 3 ? ' and everything inside it' : ''}
                  </p>
                  {locked ? (
                    <p className="mb-2 text-caption text-[var(--warn)]">
                      Labelled {SENSITIVITY_LABEL[node.label.label]}. You can Block or remove tags; only a platform admin can
                      give access.
                    </p>
                  ) : null}
                  <TagEditor
                    node={node}
                    holders={holders}
                    locked={locked}
                    busy={busy}
                    onSet={(h, level) => void setOne(node, h, level, ctx)}
                  />
                </PopoverContent>
              </Popover>
              )}
            </>
          );
        }}
      />
    </div>
  );
}

/* ── Role or department → data ───────────────────────────── */

function ByHolder({
  holders,
  grants,
  selectedKey,
  onSelect,
  isPlatformAdmin,
  afterChange,
}: {
  holders: Holder[];
  grants: Grant[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isPlatformAdmin: boolean;
  afterChange: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = useConsoleReadOnly();

  const mappable = holders;
  const current =
    holders.find((h) => holderKey(h.type, h.id) === selectedKey) ??
    mappable.find((h) => h.type === 'role' && h.id === 'member') ??
    mappable[0] ??
    null;
  const mappedCount = (h: Holder) => grants.filter((g) => g.principalType === h.type && g.principalId === h.id).length;

  async function create() {
    setBusy(true);
    setCreateError(null);
    try {
      const res = await send<{ department: Department }>('/api/access/departments', 'POST', {
        key: key || slugify(name),
        name: name.trim(),
      });
      setName('');
      setKey('');
      setKeyTouched(false);
      setCreating(false);
      await afterChange();
      onSelect(holderKey('department', res.department.id));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create the department');
    } finally {
      setBusy(false);
    }
  }

  const listItem = (h: Holder) => {
    const k = holderKey(h.type, h.id);
    const n = mappedCount(h);
    const active = current !== null && holderKey(current.type, current.id) === k;
    return (
      <button
        key={k}
        type="button"
        className={cn(s.listItem, active && s.listItemActive)}
        onClick={() => onSelect(k)}
        aria-current={active}
      >
        <span className={s.listItemTitle}>
          <span className="flex items-center gap-1.5">
            <HolderIcon h={h} />
            {h.name}
          </span>
          <span className={cn(s.chip, n ? s.chipBrand : '')}>{n} mapped</span>
        </span>
        <span className={s.listItemSub}>{h.sub}</span>
      </button>
    );
  };

  return (
    <SplitPane>
      <aside className={s.listPane} aria-label="App roles and departments">
        <div className={s.listBody}>
          <p className="px-3 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            App roles
          </p>
          {holders.filter((h) => h.type === 'role').map(listItem)}
          <div className="flex items-center justify-between px-3 pb-1 pt-4">
            <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Departments</p>
            {readOnly ? null : (
            <button
              type="button"
              className={cn(s.linkBtn, 'inline-flex items-center gap-1')}
              onClick={() => setCreating((v) => !v)}
              aria-expanded={creating}
            >
              <Plus className="h-3 w-3" /> New
            </button>
            )}
          </div>
          {creating && !readOnly ? (
            <div className={cn(s.inlineForm, 'mx-1 mb-2')}>
              <label className="text-caption text-muted-foreground" htmlFor="dept-name">
                Name
              </label>
              <Input
                id="dept-name"
                className={userStyles.input}
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  if (!keyTouched) setKey(slugify(e.target.value));
                }}
                placeholder="Marine"
              />
              <label className="text-caption text-muted-foreground" htmlFor="dept-key">
                Key <span className="opacity-70">(shown in audit logs)</span>
              </label>
              <Input
                id="dept-key"
                className={cn(userStyles.input, s.mono)}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyTouched(true);
                }}
                placeholder="marine"
              />
              {createError ? <p className={s.errorText}>{createError}</p> : null}
              <div className={s.rowActions}>
                <Button
                  type="button"
                  className={userStyles.primary}
                  disabled={busy || name.trim().length < 2}
                  onClick={() => void create()}
                >
                  {busy ? 'Creating…' : 'Create'}
                </Button>
                <Button type="button" variant="outline" className={userStyles.secondaryButton} onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {holders.some((h) => h.type === 'department') ? (
            holders.filter((h) => h.type === 'department').map(listItem)
          ) : (
            <p className="px-3 py-2 text-caption text-muted-foreground">
              None yet. A department is a team, such as Marine or Crewing, that uses the same data.
            </p>
          )}
        </div>
      </aside>
      <div className={s.detailPane}>
        {!current ? (
          <Empty icon={<Building2 className="h-8 w-8 opacity-40" />}>Nothing to map yet.</Empty>
        ) : (
          <HolderData
            key={holderKey(current.type, current.id)}
            holder={current}
            grants={grants.filter((g) => g.principalType === current.type && g.principalId === current.id)}
            isPlatformAdmin={isPlatformAdmin}
            afterChange={afterChange}
          />
        )}
      </div>
    </SplitPane>
  );
}

function HolderData({
  holder,
  grants,
  isPlatformAdmin,
  afterChange,
}: {
  holder: Holder;
  grants: Grant[];
  isPlatformAdmin: boolean;
  afterChange: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const sorted = [...grants].sort((a, b) => a.path.localeCompare(b.path));
  const isRole = holder.type === 'role';
  const readOnly = useConsoleReadOnly();

  async function change(path: string, level: Choice, ctx?: TreeContext) {
    setBusy(true);
    setError(null);
    try {
      await putLevel(holder, path, level);
      await afterChange();
      if (ctx) await ctx.reload();
      else setTreeKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change access');
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!window.confirm(`Archive ${holder.name}? Its people lose everything mapped to this department.`)) return;
    try {
      await send(`/api/access/departments/${holder.id}`, 'DELETE');
      await afterChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not archive the department');
    }
  }

  return (
    <>
      <div className={s.detailHead}>
        <div>
          <h2 className="flex items-center gap-2 text-title-card">
            <HolderIcon h={holder} /> {holder.name}
          </h2>
          <p className={s.summaryLine}>
            {sorted.length} mapped path{sorted.length === 1 ? '' : 's'} · {holder.sub}
            {isRole ? (
              <>
                <br />
                Everyone with this app role gets this data
                {holder.id === 'readonly'
                  ? ', and so does every higher role.'
                  : holder.id === 'member'
                    ? ', and so do Admins.'
                    : '.'}{' '}
                Change who has the role in Users.
              </>
            ) : (
              ' · assign people on the People tab'
            )}
          </p>
        </div>
        {!isRole && !readOnly ? (
          <Button type="button" variant="outline" className={userStyles.secondaryButton} onClick={() => void archive()}>
            Archive
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}

      <Card title={`Mapped to ${holder.name}`} hint="A catalog or schema covers every table inside it.">
        {sorted.length === 0 ? (
          <p className="text-caption text-muted-foreground">Nothing mapped yet. Add data from the tree below.</p>
        ) : (
          <ul className="flex flex-col">
            {sorted.map((g) => (
              <li key={g.id} className={s.tagEditorRow}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={s.chip}>{DEPTH_NAME[g.path.split('.').length]}</span>
                  <Mono>{g.path}</Mono>
                </span>
                <span className="flex items-center gap-2">
                  <Segmented<Choice>
                    ariaLabel={`${holder.name} access to ${g.path}`}
                    options={choices(false, false)}
                    value={g.effect === 'deny' ? 'deny' : g.level}
                    disabled={busy || readOnly}
                    onChange={(v) => void change(g.path, v)}
                  />
                  {readOnly ? null : (
                    <button type="button" className={s.linkBtn} disabled={busy} onClick={() => void change(g.path, 'none')}>
                      Remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        className="mt-[14px]"
        title={readOnly ? 'Data by catalog' : 'Add or change data'}
        hint="Pick a level on any catalog, schema, or table. A dashed outline means the level comes from a parent."
      >
        <EstateTree
          holder={{ type: holder.type, id: holder.id }}
          rightTitle={`Access for ${holder.name}`}
          refreshKey={treeKey}
          renderRight={(node, ctx) => {
            const d = node.holder;
            if (!d) return null;
            const value: Choice = d.directDeny ? 'deny' : (d.direct ?? 'none');
            const locked = !isPlatformAdmin && node.label.label !== 'internal';
            return (
              <>
                {d.blockedBy ? (
                  <span className={cn(s.chip, s.chipBad)} title={`A Block on ${d.blockedBy} overrides this`}>
                    Blocked above
                  </span>
                ) : d.inherited && !d.direct && !d.directDeny ? (
                  <span className="text-caption text-muted-foreground">from {d.inheritedFrom}</span>
                ) : null}
                {d.grantsInside > 0 && node.depth < 3 ? (
                  <span className={cn(s.chip, s.chipBrand)}>{d.grantsInside} inside</span>
                ) : null}
                {locked ? <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label={LOCK_TITLE} /> : null}
                <Segmented<Choice>
                  ariaLabel={`Access to ${node.path} for ${holder.name}`}
                  options={choices(locked)}
                  value={value}
                  inherited={!d.direct && !d.directDeny ? d.inherited : null}
                  disabled={busy || readOnly}
                  onChange={(v) => void change(node.path, v, ctx)}
                />
              </>
            );
          }}
          renderBelow={(node) => {
            const d = node.holder;
            if (!d) return null;
            const notes: string[] = [];
            if (d.direct && d.inherited && LEVEL_RANK[d.direct] <= LEVEL_RANK[d.inherited]) {
              notes.push(
                `${LEVEL_LABEL[d.inherited]} is already inherited from ${d.inheritedFrom}, so ${LEVEL_LABEL[d.direct]} here changes nothing.`,
              );
            }
            const effective = d.directDeny || d.blockedBy ? null : (d.direct ?? d.inherited);
            if (effective && node.label.label !== 'internal') {
              notes.push(
                `Labelled ${SENSITIVITY_LABEL[node.label.label]}: only people with ${SENSITIVITY_LABEL[node.label.label]} clearance can use it.`,
              );
            }
            if (notes.length === 0) return null;
            return (
              <p className={s.subNote} style={{ paddingLeft: (node.depth - 1) * 20 + 52 }}>
                {notes.join(' ')}
              </p>
            );
          }}
        />
      </Card>
    </>
  );
}
