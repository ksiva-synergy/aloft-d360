'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Database, Lock, Search, Table2, UsersRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, keyFromName, runAsync, send, type AccessGroup, type DataTag, type Person } from './api';
import { Empty } from './parts';
import { PeoplePicker } from './GiveAccess';
import { ColumnInfoButton } from './ColumnInfo';
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
  const names = new Map<string, { name: string; inherited: boolean; block: boolean }>();
  for (const r of a.inheritedRules) names.set(`${r.holderType}:${r.holderId}:${r.access === 'block'}`, { name: r.holderName, inherited: true, block: r.access === 'block' });
  for (const r of a.rules) names.set(`${r.holderType}:${r.holderId}:${r.access === 'block'}`, { name: r.holderName, inherited: false, block: r.access === 'block' });
  return [...names.values()];
}

export function DataView({ people, meId, isPlatformAdmin }: { people: Person[]; meId: string; isPlatformAdmin: boolean }) {
  const readOnly = useConsoleReadOnly();
  const [children, setChildren] = useState<Record<string, DataNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DataNode[] | null>(null);
  const [meaning, setMeaning] = useState<DataNode[] | null>(null);
  const [meaningBusy, setMeaningBusy] = useState(false);
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

  async function search() {
    const term = q.trim();
    if (term.length < 2) return;
    try {
      const res = await accessFetch<{ nodes: DataNode[] }>(`/api/access/data-tree?q=${encodeURIComponent(term)}`);
      setResults(res.nodes);
      setMeaning(null);
      setMeaningBusy(true);
      void accessFetch<{ nodes: DataNode[] }>(`/api/access/data-tree?q=${encodeURIComponent(term)}&by=meaning`)
        .then((m) => setMeaning(m.nodes))
        .catch(() => setMeaning([]))
        .finally(() => setMeaningBusy(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    }
  }

  const allNodes = useMemo(() => {
    const m = new Map<string, DataNode>();
    for (const list of Object.values(children)) for (const n of list) m.set(n.path, n);
    for (const n of results ?? []) m.set(n.path, n);
    for (const n of meaning ?? []) m.set(n.path, n);
    return m;
  }, [children, results, meaning]);
  const current = selected ? (allNodes.get(selected) ?? null) : null;

  const roots = children[ROOT];
  const nobodyCanUse = !!roots && roots.length > 0 && roots.every((n) => n.access.rules.filter((r) => r.access !== 'block').length === 0);

  function renderRows(parent: string, level: number): ReactNode {
    const list = children[parent];
    if (!list) return null;
    return list.map((n) => (
      <Fragment key={n.path}>
        <TreeRow node={n} level={level} open={expanded.has(n.path)} selected={selected === n.path} onToggle={() => void toggle(n)} onSelect={() => setSelected(n.path)} />
        {expanded.has(n.path) ? renderRows(n.path, level + 1) : null}
      </Fragment>
    ));
  }

  return (
    <div className={cn(s.split, 'min-h-[600px]')}>
      <aside className={cn(s.listPane, 'min-w-0')} aria-label="Data">
        <div className={s.listHead}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className={cn(userStyles.input, '!pl-9')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a table" aria-label="Find a table" />
            </div>
            {results ? (
              <button
                type="button"
                className={s.linkBtn}
                onClick={() => {
                  setResults(null);
                  setMeaning(null);
                }}
              >
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
                <p className="p-3 text-caption text-muted-foreground">No table names match.</p>
              ) : (
                results.map((n) => <TreeRow key={n.path} node={n} level={0} open={false} selected={selected === n.path} onSelect={() => setSelected(n.path)} showPath />)
              )}
              <p className="border-b border-[var(--estate-border)] px-3 py-2 text-eyebrow uppercase text-muted-foreground">
                Similar meaning{meaningBusy ? ' · searching…' : ''}
              </p>
              {(meaning ?? [])
                .filter((n) => !results.some((r) => r.path === n.path))
                .map((n) => (
                  <TreeRow key={`m:${n.path}`} node={n} level={0} open={false} selected={selected === n.path} onSelect={() => setSelected(n.path)} showPath hint={n.description ?? undefined} />
                ))}
              {meaning && !meaningBusy && meaning.filter((n) => !results.some((r) => r.path === n.path)).length === 0 ? (
                <p className="p-3 text-caption text-muted-foreground">Nothing else with a similar meaning.</p>
              ) : null}
            </>
          ) : !roots ? (
            <p className="p-3 text-caption text-muted-foreground">Loading…</p>
          ) : (
            renderRows(ROOT, 0)
          )}
        </div>
      </aside>

      <section className={cn(s.detailPane, 'min-w-0')} aria-label="Selected data">
        {!current ? (
          <Empty icon={<Database className="h-5 w-5" aria-hidden="true" />}>Pick a catalog, schema or table to see who can use it and what protects it.</Empty>
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
          />
        )}
      </section>
    </div>
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
  /** Replaces the who-can-use line (e.g. a table summary for meaning matches). */
  hint?: string;
}) {
  const chips = holderChips(node.access);
  const prot = [...node.access.protections, ...node.access.inheritedProtections];
  const canOpen = node.depth < 3 && (node.childCount ?? 0) > 0;
  return (
    <div
      className={cn('flex items-start gap-1 border-b border-[var(--estate-border)] px-2 py-1.5', selected && 'bg-[var(--brand-a-soft)]')}
      style={{ paddingLeft: 8 + level * 16 }}
    >
      <button
        type="button"
        className={cn(s.treeToggle, 'mt-0.5')}
        aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
        aria-expanded={canOpen ? open : undefined}
        disabled={!canOpen || !onToggle}
        onClick={onToggle}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect} aria-current={selected ? 'true' : undefined}>
        <span className="flex min-w-0 items-center gap-1.5">
          {node.depth === 3 ? <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="truncate text-size-ui font-medium" title={node.path}>
            {showPath ? node.path : node.name}
          </span>
          {prot.length ? <Lock className="h-3 w-3 shrink-0 text-[var(--brand-a-ink)]" aria-label="Protected" /> : null}
        </span>
        <span className="block truncate text-caption text-muted-foreground" title={hint}>
          {hint ? hint : chips.length ? chips.map((c) => `${c.block ? 'Blocked: ' : ''}${c.name}`).join(', ') : 'Nobody can use'}
          {node.access.protectedColumns ? ` · ${node.access.protectedColumns} protected column${node.access.protectedColumns === 1 ? '' : 's'}` : ''}
        </span>
      </button>
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
}: {
  node: DataNode;
  groups: AccessGroup[];
  tags: DataTag[];
  people: Person[];
  meId: string;
  readOnly: boolean;
  isPlatformAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const a = node.access;
  const [giving, setGiving] = useState(false);
  const [protecting, setProtecting] = useState(false);
  const kindWord = node.depth === 1 ? 'catalog' : node.depth === 2 ? 'schema' : node.kind === 'view' ? 'view' : 'table';

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-eyebrow uppercase text-muted-foreground">{kindWord}</p>
        <h2 className="break-all text-title-section">{node.path}</h2>
      </header>

      {/* Who can use it */}
      <section className={s.card} aria-label="Who can use it">
        <div className={s.cardHead}>
          <div>
            <h3 className={s.cardTitle}>Who can use it</h3>
            <p className={s.cardHint}>Use = read rows, charts, dashboards. Access here covers everything inside this {kindWord}.</p>
          </div>
          {readOnly ? null : (
            <button type="button" className={cn(userStyles.primary, 'inline-flex items-center gap-1.5')} onClick={() => setGiving(true)}>
              <UsersRound className="h-4 w-4" aria-hidden="true" />
              Give access
            </button>
          )}
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-2')}>
          {giving ? (
            <GiveRuleForm
              path={node.path}
              kindWord={kindWord}
              groups={groups}
              people={people}
              meId={meId}
              existing={a.rules}
              onCancel={() => setGiving(false)}
              onDone={async () => {
                setGiving(false);
                await onChanged();
              }}
            />
          ) : null}
          {a.rules.length === 0 && a.inheritedRules.length === 0 ? (
            <p className="text-caption text-muted-foreground">Nobody yet.</p>
          ) : null}
          {a.rules.map((r) => (
            <RuleRow key={r.id} rule={r} path={node.path} readOnly={readOnly} onChanged={onChanged} />
          ))}
          {a.inheritedRules.length ? (
            <div className="mt-1">
              <p className="mb-1 text-eyebrow uppercase text-muted-foreground">From above</p>
              <ul className="flex flex-col gap-1">
                {a.inheritedRules.map((r) => (
                  <li key={r.id} className="text-caption text-muted-foreground">
                    <span className={cn('font-medium', r.access === 'block' ? 'text-[var(--bad)]' : 'text-foreground')}>{r.holderName}</span> · {ACCESS_LABEL[r.access]} · set on{' '}
                    <code>{r.from}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {/* Protections */}
      <section className={s.card} aria-label="Protections">
        <div className={s.cardHead}>
          <div>
            <h3 className={s.cardTitle}>Protection</h3>
            <p className={s.cardHint}>A protected {kindWord} also needs the protection, even for people who can use it.</p>
          </div>
          {readOnly ? null : (
            <button type="button" className={userStyles.secondaryButton} onClick={() => setProtecting(true)}>
              Protect this {kindWord}
            </button>
          )}
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-2')}>
          {protecting ? (
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
          ) : null}
          {a.protections.length === 0 && a.inheritedProtections.length === 0 ? (
            <p className="text-caption text-muted-foreground">Not protected as a whole.{a.protectedColumns ? ` ${a.protectedColumns} protected column(s) inside.` : ''}</p>
          ) : null}
          {a.protections.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2">
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
            </div>
          ))}
          {a.inheritedProtections.map((p) => (
            <p key={p.id} className="text-caption text-muted-foreground">
              <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {p.name} · set on <code>{p.from}</code>
            </p>
          ))}
        </div>
      </section>

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

  return (
    <div className="rounded-[8px] border border-[var(--estate-border)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{rule.holderName}</span>
        <span className="text-caption text-muted-foreground">{rule.holderType === 'builtin' ? 'built-in group' : rule.holderType === 'group' ? 'group' : 'person'}</span>
        {readOnly ? (
          <span className={cn(s.chip, rule.access === 'block' && s.chipBad)}>{ACCESS_LABEL[rule.access]}</span>
        ) : (
          <select
            className={cn(userStyles.input, 'ml-auto h-8 w-auto py-0')}
            value={to ?? rule.access}
            aria-label={`Access for ${rule.holderName}`}
            onChange={(e) => setTo(e.target.value as Access | 'none')}
          >
            <option value="use">Use</option>
            <option value="export">Use + export</option>
            <option value="block">Block</option>
            <option value="none">Remove</option>
          </select>
        )}
        {rule.expiresAt ? <span className="text-caption text-muted-foreground">until {new Date(rule.expiresAt).toLocaleDateString()}</span> : null}
      </div>
      {rule.access !== 'block' && (to ?? rule.access) !== 'block' && (to ?? rule.access) !== 'none' ? (
        <label className="mt-1 flex items-center gap-2 text-caption text-muted-foreground">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={autoTo ?? rule.autoApprove}
            onChange={(e) => setAutoTo(e.target.checked)}
            aria-label={`Approve requests automatically for ${rule.holderName}`}
          />
          Approve requests for this data automatically (only if it is not protected)
        </label>
      ) : null}
      {accessChanged || autoChanged ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input className={cn(userStyles.input, 'h-8 min-w-[200px] flex-1')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (audit log)" aria-label="Reason" autoFocus />
          <button type="button" className={userStyles.primary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : to === 'none' ? 'Remove' : 'Save'}
          </button>
          <button
            type="button"
            className={s.linkBtn}
            onClick={() => {
              setTo(null);
              setAutoTo(null);
            }}
          >
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
  onCancel,
  onDone,
}: {
  path: string;
  kindWord: string;
  groups: AccessGroup[];
  people: Person[];
  meId: string;
  existing: NodeRule[];
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
        <select className={userStyles.input} value={builtinId} onChange={(e) => setBuiltinId(e.target.value)} aria-label="Built-in group">
          {BUILTINS.map((b) => (
            <option key={b.id} value={b.id} disabled={taken.has(`builtin:${b.id}`)}>
              {b.name} ({b.hint})
            </option>
          ))}
        </select>
      ) : kind === 'group' ? (
        <>
          <select className={userStyles.input} value={groupId || '__new__'} onChange={(e) => setGroupId(e.target.value)} aria-label="Group">
            {groups.map((g) => (
              <option key={g.id} value={g.id} disabled={taken.has(`group:${g.id}`)}>
                {g.name} ({g.members.filter((m) => !m.expired).length} people)
              </option>
            ))}
            <option value="__new__">+ Create a new group</option>
          </select>
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
    <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--surface-2)] p-3">
      <select className={userStyles.input} value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="Protection">
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <p className="text-caption text-muted-foreground">Everyone without this protection is refused the whole {kindWord}, even if they can use it.</p>
      <Input className={userStyles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the audit log)" aria-label="Reason" />
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

  const load = useCallback(async () => {
    const res = await accessFetch<{ columns: Column[] }>(`/api/access/data-tree/columns?table=${encodeURIComponent(table)}`);
    setCols(res.columns);
  }, [table]);
  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load columns')));
  }, [load]);

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
    <section className={s.card} aria-label="Columns">
      <div className={s.cardHead}>
        <div>
          <h3 className={s.cardTitle}>Columns</h3>
          <p className={s.cardHint}>People without a column's protection see ••• and can request access.</p>
        </div>
      </div>
      <div className={s.cardBody}>
        {error ? <p className={cn(s.errorText, 'mb-2')}>{error}</p> : null}
        {cols === null ? (
          <p className="text-caption text-muted-foreground">Loading…</p>
        ) : cols.length === 0 ? (
          <p className="text-caption text-muted-foreground">No harvested columns for this table.</p>
        ) : (
          <ul className="compact-scroll max-h-80 divide-y divide-[var(--estate-border)] rounded-[8px] border border-[var(--estate-border)]">
            {cols.map((c) => (
              <li key={c.name} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-caption">
                {readOnly || tags.length === 0 ? null : (
                  <input
                    type="checkbox"
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
                  />
                )}
                <span className="min-w-0 truncate font-medium text-foreground" title={c.name}>
                  {c.name}
                </span>
                <ColumnInfoButton table={table} column={c.name} />
                {c.type ? <span className="text-muted-foreground">{c.type}</span> : null}
                <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
                  {c.protections.map((p) => (
                    <span key={p.tagId} className={cn(s.chip, s.chipBrand)}>
                      <Lock className="h-3 w-3" aria-hidden="true" />
                      {p.name}
                      {!readOnly && isPlatformAdmin ? (
                        <InlineReason
                          label="×"
                          ariaLabel={`Stop protecting ${c.name} as ${p.name}`}
                          onConfirm={(reason) =>
                            send('/api/access/column-tags', 'DELETE', { tablePath: table, column: c.name, tagId: p.tagId, reason }).then(() => Promise.all([load(), onChanged()]))
                          }
                        />
                      ) : null}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {picked.size > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-caption font-medium">Protect {picked.size} as</span>
            <select className={cn(userStyles.input, 'h-8 w-auto py-0')} value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="Protection for columns">
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Input className={cn(userStyles.input, 'h-8 min-w-[180px] flex-1')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason for columns" />
            <button type="button" className={userStyles.primary} onClick={() => void protect()}>
              Protect
            </button>
          </div>
        ) : null}
      </div>
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

