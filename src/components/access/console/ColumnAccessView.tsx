'use client';

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Lock, Plus, Unlock, Search, ShieldCheck, User, UserPlus, UsersRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import userStyles from '@/components/users/users.module.css';
import {
  accessFetch,
  keyFromName,
  personName,
  runAsync,
  send,
  type AccessGroup,
  type ColumnTagRow,
  isPathLevelTag,
  type DataTag,
  type Person,
  type TagGrant,
} from './api';
import { ConfirmButton, Empty, Segmented, SplitPane } from './parts';
import { ColumnInfoButton, ColumnInfoDialog } from './ColumnInfo';
import {
  AccessFields,
  DURATIONS,
  PeoplePicker,
  applyAccess,
  choiceProblem,
  emptyChoice,
  expiryFor,
  type AccessChoice,
  type Duration,
} from './GiveAccess';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

/* ─────────────────────────────────────────────────────────────────────────────
 * Column access: protections first.
 *
 *   ┌ PROTECTIONS ───────┐ ┌ 🔒 compensation ───────────────────────────────┐
 *   │ [+ New protection] │ │ Can see: Payroll team (8)        [Who can see] │
 *   │ ● compensation  53 │ │ [ add columns: search e.g. salary ] [Search]   │
 *   │   Contact det.   0 │ │ ☐ column   table                               │
 *   └────────────────────┘ └────────────────────────────────────────────────┘
 *
 * Pick a protection on the left; on the right see who can see it, add columns by search, and
 * remove or move its columns. Behind the scenes a protection is a data tag plus the people and
 * groups granted it.
 * ──────────────────────────────────────────────────────────────────────────── */

type Row = {
  key: string;
  tablePath: string;
  column: string;
  kind?: string;
  type?: string | null;
  tagIds: string[];
  /** Search by meaning: the column's description and how close it is (0–1). Never values. */
  description?: string | null;
  score?: number;
  match?: 'name' | 'meaning';
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const rowKey = (table: string, column: string) => `${table}.${column}`;
/** "curated_db.crewing_public.contract_agreements" → schema.table for the list; full path on hover. */
const shortTable = (path: string) => path.split('.').slice(1).join('.');
const activeMembers = (g: AccessGroup) => g.members.filter((m) => !m.expired);
/** Plain-language closeness, relative to the best match of the same search. */
const strength = (score: number, top: number) => (top > 0 && score >= top * 0.9 ? 'close match' : 'possible match');

export function ColumnAccessView({
  people,
  meId,
  isPlatformAdmin,
  onChanged,
}: {
  people: Person[];
  meId: string;
  isPlatformAdmin: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const readOnly = useConsoleReadOnly();
  const [tags, setTags] = useState<DataTag[] | null>(null);
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [grants, setGrants] = useState<TagGrant[]>([]);
  const [wholePaths, setWholePaths] = useState<{ tagId: string; path: string }[]>([]);
  const [protectedRows, setProtectedRows] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, Row>>(new Map());
  const [dialog, setDialog] = useState<'change' | 'unprotect' | 'new' | { tagId: string } | null>(null);
  const [columnDetail, setColumnDetail] = useState<{ table: string; column: string } | null>(null);
  const [listFilter, setListFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, g, c, gr, pp] = await Promise.all([
      accessFetch<{ tags: DataTag[] }>('/api/access/tags'),
      accessFetch<{ groups: AccessGroup[] }>('/api/access/groups'),
      accessFetch<{ columnTags: ColumnTagRow[] }>('/api/access/column-tags'),
      accessFetch<{ grants: TagGrant[] }>('/api/access/tag-grants'),
      accessFetch<{ pathProtections: { tagId: string; path: string }[] }>('/api/access/path-protections'),
    ]);
    const active = new Set(t.tags.map((x) => x.id));
    const byColumn = new Map<string, Row>();
    for (const ct of c.columnTags) {
      if (ct.status !== 'confirmed' || !active.has(ct.tagId)) continue;
      const k = rowKey(ct.tablePath, ct.column);
      const row = byColumn.get(k) ?? { key: k, tablePath: ct.tablePath, column: ct.column, tagIds: [] };
      row.tagIds.push(ct.tagId);
      byColumn.set(k, row);
    }
    setTags(t.tags);
    setGroups(g.groups);
    setGrants(gr.grants);
    setWholePaths(pp.pathProtections);
    setProtectedRows([...byColumn.values()].sort((a, b) => a.column.localeCompare(b.column) || a.tablePath.localeCompare(b.tablePath)));
    setSelectedId((cur) => (cur && t.tags.some((x) => x.id === cur) ? cur : (t.tags[0]?.id ?? null)));
    setError(null);
  }, []);

  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load column access')));
  }, [load]);

  async function afterChange(message: string) {
    setDialog(null);
    setSelected(new Map());
    setNotice(message);
    await Promise.all([load(), onChanged()]);
  }

  const tagById = useMemo(() => new Map((tags ?? []).map((t) => [t.id, t])), [tags]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  /** "Payroll team (8), Ana Rao" for a tag. */
  const whoCanSee = useCallback(
    (tagId: string) => {
      const gs = grants.filter((g) => g.tagId === tagId);
      if (gs.length === 0) return 'nobody yet';
      return gs
        .map((g) => {
          if (g.principalType !== 'group') return personName(people.find((p) => p.id === g.principalId), 'one person');
          const grp = groupById.get(g.principalId);
          const label = grp ? `${grp.name} (${activeMembers(grp).length})` : 'archived group';
          return g.level === 'aggregate' ? `${label}, totals only` : label;
        })
        .join(', ');
    },
    [grants, groupById, people],
  );

  useEffect(() => {
    setColumnDetail(null);
    setListFilter('');
  }, [selectedId]);

  const current = selectedId ? (tagById.get(selectedId) ?? null) : null;

  const openColumnDetail = (table: string, column: string) => setColumnDetail({ table, column });

  const onColumnRowClick = (table: string, column: string) => (e: MouseEvent | KeyboardEvent) => {
    const target = e.target;
    if (target instanceof Element && target.closest('input, button, a, select, textarea')) return;
    if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return;
    if ('key' in e) e.preventDefault();
    openColumnDetail(table, column);
  };
  const columns = current ? protectedRows.filter((r) => r.tagIds.includes(current.id)) : [];
  const countFor = (id: string) => protectedRows.filter((r) => r.tagIds.includes(id)).length;
  const filterTerm = listFilter.trim().toLowerCase();
  const filteredColumns = useMemo(() => {
    if (!filterTerm) return columns;
    return columns.filter((r) => r.column.toLowerCase().includes(filterTerm) || r.tablePath.toLowerCase().includes(filterTerm));
  }, [columns, filterTerm]);
  const flatColumns = useMemo(
    () => [...filteredColumns].sort((a, b) => a.column.localeCompare(b.column) || a.tablePath.localeCompare(b.tablePath)),
    [filteredColumns],
  );
  const chosen = [...selected.values()];
  const allSelected = filteredColumns.length > 0 && filteredColumns.every((r) => selected.has(r.key));
  const accessSummary = current ? whoCanSee(current.id) : '';
  const accessOpen = accessSummary === 'nobody yet';

  function pick(id: string) {
    setSelectedId(id);
    setSelected(new Map());
    setNotice(null);
  }

  function toggle(r: Row, on: boolean) {
    setSelected((cur) => {
      const next = new Map(cur);
      if (on) next.set(r.key, r);
      else next.delete(r.key);
      return next;
    });
  }

  return (
    <SplitPane>
      {/* ── Protections ───────────────────────────────────────────────── */}
      <aside className={s.listPane} aria-label="Protections">
        <div className={s.listHead}>
          <span className="text-eyebrow uppercase text-muted-foreground">Protections</span>
          {isPlatformAdmin && !readOnly ? (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-[10px] border border-dashed border-[var(--brand-a)] px-3 py-2 text-size-ui font-medium text-[var(--brand-a-ink)] hover:bg-[var(--brand-a-soft)]"
              onClick={() => setDialog('new')}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New protection
            </button>
          ) : null}
        </div>
        <div className={s.listBody}>
          {tags === null ? (
            <p className="p-3 text-caption text-muted-foreground">Loading…</p>
          ) : tags.length === 0 ? (
            <p className="p-3 text-caption text-muted-foreground">
              None yet. A protection is a kind of sensitive data, like Compensation or Contact details.
            </p>
          ) : (
            tags.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={t.id === selectedId ? 'true' : undefined}
                className={cn(s.listItem, t.id === selectedId && s.listItemActive)}
                onClick={() => pick(t.id)}
              >
                <span className={s.listItemTitle}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--brand-a-ink)]" aria-hidden="true" />
                    <span className="truncate">{t.name}</span>
                  </span>
                  <span className={s.navCount}>{countFor(t.id)}</span>
                </span>
                <span className={cn(s.listItemSub, 'truncate')}>Can see: {whoCanSee(t.id)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Selected protection ──────────────────────────────────────── */}
      <section className={cn(s.detailPane, 'flex min-w-0 flex-col gap-4')}>
        {error ? (
          <p className={s.errorText} role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="flex items-center gap-2 rounded-[8px] bg-[var(--ok-bg)] px-3 py-2 text-caption text-[var(--ok)]" role="status">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            {notice}
            <button type="button" className="ml-auto" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </p>
        ) : null}

        {!current ? (
          <Empty icon={<Lock className="h-5 w-5" aria-hidden="true" />}>
            {tags && tags.length === 0
              ? isPlatformAdmin
                ? 'Start with New protection, for example Compensation, then add its columns.'
                : 'Nothing is protected yet. A platform admin creates the first protection.'
              : 'Pick a protection on the left.'}
          </Empty>
        ) : (
          <>
            <header className={cn(s.detailHead, s.detailHeadCompact)}>
              <div className="min-w-0 flex-1">
                <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-title-section">
                  <Lock className="h-4 w-4 text-[var(--brand-a-ink)]" aria-hidden="true" />
                  {current.name}
                  <span className={cn('text-caption font-normal', accessOpen ? 'text-[var(--warn)]' : 'text-muted-foreground')}>
                    · Can see: {accessSummary}
                  </span>
                </h2>
                {wholePaths.some((w) => w.tagId === current.id) ? (
                  <p className="mt-0.5 truncate text-caption text-muted-foreground" title={wholePaths.filter((w) => w.tagId === current.id).map((w) => w.path).join(', ')}>
                    Whole path on Data tab: {wholePaths.filter((w) => w.tagId === current.id).map((w) => w.path).join(', ')}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className={cn(
                  s.protectCompactBtn,
                  accessOpen && isPlatformAdmin && !readOnly ? userStyles.primary : userStyles.secondaryButton,
                )}
                onClick={() => setDialog({ tagId: current.id })}
              >
                <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
                {isPlatformAdmin && !readOnly ? 'Give access' : 'Who can see'}
              </button>
            </header>

            {readOnly ? null : (
              <AddColumns
                tag={current}
                tagById={tagById}
                onAdded={(n) => afterChange(`${plural(n, 'column')} added to ${current.name}.`)}
              />
            )}

            <div className={s.card}>
              <div className={cn(s.cardHead, s.protectListHead)}>
                <h3 className={s.cardTitle}>{plural(columns.length, 'Protected column')}</h3>
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:justify-end">
                  {columns.length > 4 ? (
                    <div className="relative w-full min-w-0 flex-1 sm:max-w-xs">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input
                        className={cn(userStyles.input, '!h-8 !py-1 !pl-8 text-caption')}
                        value={listFilter}
                        onChange={(e) => setListFilter(e.target.value)}
                        placeholder="Filter…"
                        aria-label="Filter protected columns"
                      />
                    </div>
                  ) : null}
                  {!readOnly && isPlatformAdmin && filteredColumns.length > 0 ? (
                    <button
                      type="button"
                      className={cn(s.linkBtn, 'shrink-0 text-caption')}
                      onClick={() => filteredColumns.forEach((r) => toggle(r, !allSelected))}
                    >
                      {allSelected ? 'Clear selection' : 'Select all'}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className={cn(s.cardBody, '!pt-0')}>
                {columns.length === 0 ? (
                  <Empty icon={<Search className="h-5 w-5" aria-hidden="true" />}>
                    No columns yet. Use <strong>Add columns</strong> above, for example <strong>salary</strong>.
                  </Empty>
                ) : filteredColumns.length === 0 ? (
                  <p className="py-8 text-center text-caption text-muted-foreground">No columns match “{listFilter.trim()}”.</p>
                ) : (
                  <ul className={cn(s.protectColumnList, 'compact-scroll max-h-[min(50vh,480px)]')}>
                    {flatColumns.map((r) => (
                      <li key={r.key}>
                        <div
                          role="button"
                          tabIndex={0}
                          title={r.tablePath}
                          className={cn(s.protectColumnRow, selected.has(r.key) && s.protectColumnRowSelected)}
                          onClick={onColumnRowClick(r.tablePath, r.column)}
                          onKeyDown={onColumnRowClick(r.tablePath, r.column)}
                        >
                          {!readOnly && isPlatformAdmin ? (
                            <input
                              type="checkbox"
                              className="shrink-0"
                              aria-label={`Select ${r.column} in ${r.tablePath}`}
                              checked={selected.has(r.key)}
                              onChange={(e) => toggle(r, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{r.column}</span>
                          <span className="hidden min-w-0 max-w-[48%] truncate text-caption text-muted-foreground sm:inline" title={r.tablePath}>
                            {shortTable(r.tablePath)}
                          </span>
                          {r.tagIds.length > 1 ? (
                            <span className={cn(s.chip, s.chipFaint, 'hidden shrink-0 lg:inline-flex')}>
                              +{r.tagIds.length - 1}
                            </span>
                          ) : null}
                          <span className="sr-only"> — {r.tablePath}. Open for details.</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {chosen.length > 0 ? (
              <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--estate-border)] bg-[var(--estate-surface)] px-4 py-3 shadow-[var(--shadow-card)]">
                <span className="text-size-ui font-semibold">{plural(chosen.length, 'column')} selected</span>
                <button type="button" className={cn(userStyles.secondaryButton, 'inline-flex items-center gap-1.5')} onClick={() => setDialog('change')}>
                  <UsersRound className="h-4 w-4" aria-hidden="true" />
                  Move to another protection…
                </button>
                <button type="button" className={cn(userStyles.secondaryButton, 'inline-flex items-center gap-1.5')} onClick={() => setDialog('unprotect')}>
                  <Unlock className="h-4 w-4" aria-hidden="true" />
                  Remove from {current.name}
                </button>
                <button type="button" className={cn(s.linkBtn, 'ml-auto')} onClick={() => setSelected(new Map())}>
                  Clear
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {columnDetail ? (
        <ColumnInfoDialog table={columnDetail.table} column={columnDetail.column} onClose={() => setColumnDetail(null)} />
      ) : null}

      <ProtectDialog
        open={dialog === 'change'}
        mode="change"
        columns={chosen.map((r) => ({ ...r, tagIds: current ? [current.id] : r.tagIds }))}
        tags={(tags ?? []).filter((t) => !isPathLevelTag(t))}
        groups={groups}
        people={people}
        meId={meId}
        isPlatformAdmin={isPlatformAdmin}
        whoCanSee={whoCanSee}
        onClose={() => setDialog(null)}
        onDone={afterChange}
      />
      <UnprotectDialog
        open={dialog === 'unprotect'}
        columns={chosen.map((r) => ({ ...r, tagIds: current ? [current.id] : r.tagIds }))}
        tagById={tagById}
        onClose={() => setDialog(null)}
        onDone={afterChange}
      />
      <NewProtectionDialog
        open={dialog === 'new'}
        groups={groups}
        people={people}
        meId={meId}
        existingNames={(tags ?? []).map((t) => t.name.toLowerCase())}
        onClose={() => setDialog(null)}
        onDone={async (message, id) => {
          // Open the new protection; the reload keeps it selected and the notice stays visible.
          if (id) setSelectedId(id);
          await afterChange(message);
        }}
      />
      <ProtectionDialog
        tag={dialog && typeof dialog === 'object' ? (tagById.get(dialog.tagId) ?? null) : null}
        columnCount={dialog && typeof dialog === 'object' ? countFor(dialog.tagId) : 0}
        grants={dialog && typeof dialog === 'object' ? grants.filter((g) => g.tagId === dialog.tagId) : []}
        groups={groups}
        people={people}
        meId={meId}
        readOnly={readOnly}
        isPlatformAdmin={isPlatformAdmin}
        onClose={() => setDialog(null)}
        onChanged={async () => {
          await Promise.all([load(), onChanged()]);
        }}
      />
    </SplitPane>
  );
}

/* ── Add columns to the selected protection: search, tick, reason, add ───── */

function AddColumns({
  tag,
  tagById,
  onAdded,
}: {
  tag: DataTag;
  tagById: Map<string, DataTag>;
  onAdded: (count: number) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Row[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Map<string, Row>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Switching protection starts a fresh search.
  const [forTag, setForTag] = useState(tag.id);
  if (forTag !== tag.id) {
    setForTag(tag.id);
    setHits(null);
    setPicked(new Map());
    setQ('');
  }

  async function search() {
    const term = q.trim();
    if (term.length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const res = await accessFetch<{ columns: Omit<Row, 'key'>[]; truncated: boolean }>(
        `/api/access/column-search?q=${encodeURIComponent(term)}`,
      );
      setHits(res.columns.map((h) => ({ ...h, key: rowKey(h.tablePath, h.column) })));
      setTruncated(res.truncated);
      setPicked(new Map());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  const addable = (hits ?? []).filter((h) => !h.tagIds.includes(tag.id));
  const meaningTop = (hits ?? []).find((h) => h.match === 'meaning')?.score ?? hits?.[0]?.score ?? 0;
  const allPicked = addable.length > 0 && addable.every((h) => picked.has(h.key));
  const chosen = [...picked.values()];

  function toggle(h: Row, on: boolean) {
    setPicked((cur) => {
      const next = new Map(cur);
      if (on) next.set(h.key, h);
      else next.delete(h.key);
      return next;
    });
  }

  async function add() {
    setBusy(true);
    setError(null);
    try {
      for (const table of new Set(chosen.map((h) => h.tablePath))) {
        await send('/api/access/column-tags', 'POST', {
          tablePath: table,
          columns: chosen.filter((h) => h.tablePath === table).map((h) => h.column),
          tagId: tag.id,
        });
      }
      const n = chosen.length;
      setHits(null);
      setPicked(new Map());
      setQ('');
      await onAdded(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the columns');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(s.protectAddBlock, 'flex flex-col gap-1.5')}>
      <form
        className={cn(s.protectToolbar, 'gap-1.5 !py-1.5')}
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <span className="hidden shrink-0 text-caption font-medium text-muted-foreground sm:inline">Add</span>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className={cn(userStyles.input, s.protectCompactInput)}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find columns, e.g. salary"
            aria-label="Search columns"
          />
        </div>
        <button type="submit" className={cn(s.protectCompactBtn, userStyles.primary)} disabled={q.trim().length < 2 || searching}>
          {searching ? '…' : 'Search'}
        </button>
        {hits ? (
          <button
            type="button"
            className={cn(s.linkBtn, s.protectCompactBtn, '!px-2')}
            onClick={() => {
              setHits(null);
              setPicked(new Map());
            }}
          >
            Close
          </button>
        ) : null}
      </form>

      {error ? <p className={s.errorText} role="alert">{error}</p> : null}

      {hits ? (
        <div className="rounded-[10px] border border-[var(--estate-border)] bg-[var(--surface-2)] p-2">
          {hits.length === 0 ? (
            <p className="px-2 py-1 text-caption text-muted-foreground">No columns match name or meaning for “{q.trim()}”.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 px-2 py-1 text-caption font-medium">
                <input
                  type="checkbox"
                  checked={allPicked}
                  disabled={addable.length === 0}
                  onChange={(e) => addable.forEach((h) => toggle(h, e.target.checked))}
                />
                Select all {addable.length}
                {truncated ? <span className="font-normal text-muted-foreground"> · first 150 shown, type more to narrow</span> : null}
              </label>
              <ul className="compact-scroll max-h-64 rounded-[8px] border border-[var(--estate-border)] bg-[var(--estate-surface)]">
                {hits.map((h) => {
                  const already = h.tagIds.includes(tag.id);
                  const others = h.tagIds.filter((id) => id !== tag.id).map((id) => tagById.get(id)?.name).filter(Boolean);
                  return (
                    <li key={h.key} className="border-b border-[var(--estate-border)] last:border-b-0">
                      <label className={cn('flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-caption', already && 'cursor-default opacity-60')}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${h.column} in ${h.tablePath}`}
                          disabled={already}
                          checked={already || picked.has(h.key)}
                          onChange={(e) => toggle(h, e.target.checked)}
                        />
                        <span className="shrink-0 font-medium text-foreground">{h.column}</span>
                        <ColumnInfoButton table={h.tablePath} column={h.column} />
                        <span className="min-w-0 truncate text-muted-foreground" title={h.tablePath}>
                          {shortTable(h.tablePath)}
                          {h.kind === 'view' ? ' · view' : ''}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {h.match === 'meaning' ? (
                            <span className={cn(s.chip, 'shrink-0')} title={h.description ?? undefined}>
                              {strength(h.score ?? 0, meaningTop)}
                            </span>
                          ) : null}
                          {others.map((n) => (
                            <span key={n} className={s.chip}>
                              also {n}
                            </span>
                          ))}
                          {already ? <span className={cn(s.chip, s.chipBrand)}>already in {tag.name}</span> : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {chosen.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
              <button type="button" className={userStyles.primary} disabled={busy} onClick={() => void add()}>
                {busy ? 'Adding…' : `Add ${plural(chosen.length, 'column')} to ${tag.name}`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── Dialog shell ─────────────────────────────────────────────────────────── */

function Shell({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      {/* The dialog renders outside the page, so it needs the users surface for button and input styles. */}
      <DialogContent className={cn(userStyles.surface, 'max-w-xl overflow-x-hidden')}>
        <div role="dialog" aria-modal="true" aria-label={title}>
          <div className="mb-4 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-title-card">{title}</h2>
              {subtitle ? <div className="mt-1 text-caption text-muted-foreground">{subtitle}</div> : null}
            </div>
            <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-col gap-4">{children}</div>
          {footer ? <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{footer}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReasonField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-caption font-medium">Reason (kept in the audit log)</span>
      <Input className={userStyles.input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label="Reason" />
    </label>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function needReason(reason: string) {
  if (reason.trim().length < 5) throw new Error('Give a reason (at least 5 characters)');
}

function ColumnList({ columns }: { columns: Row[] }) {
  const shown = columns.slice(0, 6);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <li key={c.key} className={s.chip} title={c.tablePath}>
          {c.column}
        </li>
      ))}
      {columns.length > shown.length ? <li className="text-caption text-muted-foreground">+{columns.length - shown.length} more</li> : null}
    </ul>
  );
}

function FooterButtons({ busy, error, label, onCancel, onSave, danger }: { busy: boolean; error: string | null; label: string; onCancel: () => void; onSave: () => void; danger?: boolean }) {
  return (
    <>
      {error ? <span className={cn(s.errorText, 'mr-auto')} role="alert">{error}</span> : null}
      <button type="button" className={userStyles.secondaryButton} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className={cn(userStyles.primary, danger && userStyles.danger)} disabled={busy} onClick={onSave}>
        {busy ? 'Saving…' : label}
      </button>
    </>
  );
}

/* ── Protect: who can see these columns? ─────────────────────────────────── */

function ProtectDialog({
  open,
  mode,
  columns,
  tags,
  groups,
  people,
  meId,
  isPlatformAdmin,
  whoCanSee,
  onClose,
  onDone,
}: {
  open: boolean;
  /** protect: unprotected columns. change: protected columns move to another protection. */
  mode: 'protect' | 'change';
  columns: Row[];
  tags: DataTag[];
  groups: AccessGroup[];
  people: Person[];
  meId: string;
  isPlatformAdmin: boolean;
  whoCanSee: (tagId: string) => string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const NEW = '__new__';
  // When changing, don't offer the protection the columns already have.
  const current = new Set(mode === 'change' ? columns.flatMap((c) => c.tagIds) : []);
  const options = tags.filter((t) => !current.has(t.id));
  const [choice, setChoice] = useState<string>(options[0]?.id ?? NEW);
  const [name, setName] = useState('');
  const [access, setAccess] = useState<AccessChoice>(() => emptyChoice(groups));
  const [reason, setReason] = useState('');

  // Reset each time the dialog opens.
  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setChoice(options[0]?.id ?? (isPlatformAdmin ? NEW : ''));
      setName('');
      setAccess(emptyChoice(groups));
      setReason('');
    }
  }

  const isNew = choice === NEW;
  const tables = [...new Set(columns.map((c) => c.tablePath))];

  const { busy, error, run } = useSubmit(async () => {
    if (!choice) throw new Error('Pick who can see these columns');
    if (isNew) {
      if (name.trim().length < 2) throw new Error('Name the data, e.g. Salary');
      const problem = choiceProblem(access);
      if (problem) throw new Error(problem);
    }
    needReason(reason);
    let tagId = choice;
    let label = tags.find((t) => t.id === choice)?.name ?? '';
    if (isNew) {
      const tag = await send<{ tag: DataTag }>('/api/access/tags', 'POST', { key: keyFromName(name), name: name.trim(), reason: reason.trim() });
      tagId = tag.tag.id;
      label = tag.tag.name;
      await applyAccess(tagId, access, reason.trim(), people);
    }
    for (const table of tables) {
      await send('/api/access/column-tags', 'POST', {
        tablePath: table,
        columns: columns.filter((c) => c.tablePath === table).map((c) => c.column),
        tagId,
        reason: reason.trim(),
      });
    }
    if (mode === 'change') {
      // Tag with the new protection first, then remove the old one, so the columns are never unprotected.
      for (const c of columns) {
        for (const old of c.tagIds) {
          if (old === tagId) continue;
          await send('/api/access/column-tags', 'DELETE', { tablePath: c.tablePath, column: c.column, tagId: old, reason: reason.trim() });
        }
      }
      await onDone(`${plural(columns.length, 'column')} moved to ${label}.`);
      return;
    }
    await onDone(`${plural(columns.length, 'column')} protected as ${label}.`);
  });

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={mode === 'change' ? `Change who can see ${plural(columns.length, 'column')}` : `Protect ${plural(columns.length, 'column')}`}
      subtitle={<ColumnList columns={columns} />}
      footer={<FooterButtons busy={busy} error={error} label={mode === 'change' ? 'Change' : 'Protect'} onCancel={onClose} onSave={() => void run()} />}
    >
      {mode === 'change' ? (
        <p className="text-caption text-muted-foreground">
          Now: {[...current].map((id) => `${tags.find((t) => t.id === id)?.name ?? '…'} (${whoCanSee(id)})`).join(', ')}. The columns stay
          protected while they move.
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-size-ui font-semibold">{mode === 'change' ? 'Move them to' : 'Protect them as'}</legend>
        {isPlatformAdmin ? (
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5',
              isNew ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)]' : 'border-dashed border-[var(--estate-border)]',
            )}
          >
            <input type="radio" name="protection" className="mt-1" checked={isNew} onChange={() => setChoice(NEW)} />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create new
              </span>
              <span className="block text-caption text-muted-foreground">
                Name the data (e.g. Contact details, Bonus) and choose the people or group who can see it
              </span>
            </span>
          </label>
        ) : null}
        {options.length > 0 ? (
          <p className="mt-1 text-eyebrow uppercase text-muted-foreground">{isPlatformAdmin ? 'Or use an existing one' : 'Use an existing one'}</p>
        ) : null}
        {options.map((t) => (
          <label
            key={t.id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5',
              choice === t.id ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)]' : 'border-[var(--estate-border)]',
            )}
          >
            <input type="radio" name="protection" className="mt-1" checked={choice === t.id} onChange={() => setChoice(t.id)} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                {t.name}
              </span>
              <span className="block text-caption text-muted-foreground">Can see: {whoCanSee(t.id)}</span>
            </span>
          </label>
        ))}
        {!isPlatformAdmin ? (
          <p className="text-caption text-muted-foreground">
            {options.length === 0 ? 'Nothing is set up yet. ' : ''}Only a platform admin can create a new one.
          </p>
        ) : null}
      </fieldset>

      {isNew ? (
        <div className="flex flex-col gap-4 rounded-[10px] bg-[var(--surface-2)] p-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium">What is this data called?</span>
            <Input className={userStyles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salary" aria-label="Data name" />
            <span className="text-caption text-muted-foreground">
              People without access are told: “you don't have access to {name.trim() || 'Salary'} data”.
            </span>
          </label>
          <AccessFields value={access} onChange={setAccess} groups={groups} people={people} meId={meId} />
        </div>
      ) : null}

      <ReasonField value={reason} onChange={setReason} placeholder="e.g. pay data is need-to-know" />
      {tables.length > 1 ? <p className="text-caption text-muted-foreground">Covers {plural(tables.length, 'table')}.</p> : null}
    </Shell>
  );
}

/* ── New protection on its own (columns are added later) ─────────────────── */

function NewProtectionDialog({
  open,
  groups,
  people,
  meId,
  existingNames,
  onClose,
  onDone,
}: {
  open: boolean;
  groups: AccessGroup[];
  people: Person[];
  meId: string;
  existingNames: string[];
  onClose: () => void;
  onDone: (message: string, newTagId?: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [access, setAccess] = useState<AccessChoice>(() => emptyChoice(groups));
  const [reason, setReason] = useState('');

  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setName('');
      setAccess(emptyChoice(groups));
      setReason('');
    }
  }

  const { busy, error, run } = useSubmit(async () => {
    if (name.trim().length < 2) throw new Error('Name it, e.g. Contact details');
    if (existingNames.includes(name.trim().toLowerCase())) throw new Error(`“${name.trim()}” already exists`);
    const problem = choiceProblem(access);
    if (problem) throw new Error(problem);
    needReason(reason);
    const tag = await send<{ tag: DataTag }>('/api/access/tags', 'POST', { key: keyFromName(name), name: name.trim(), reason: reason.trim() });
    await applyAccess(tag.tag.id, access, reason.trim(), people);
    await onDone(`Created ${tag.tag.name}. Now add its columns: search above and tick them.`, tag.tag.id);
  });

  return (
    <Shell
      open={open}
      onClose={onClose}
      title="New protection"
      subtitle="Like compensation: a kind of sensitive data and who can see it. You add its columns from the list afterwards."
      footer={<FooterButtons busy={busy} error={error} label="Create" onCancel={onClose} onSave={() => void run()} />}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium">Name</span>
        <Input className={userStyles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Contact details, Bonus, Medical" aria-label="Data name" />
        <span className="text-caption text-muted-foreground">
          People without access are told: “you don't have access to {name.trim() || 'Contact details'} data”.
        </span>
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-size-ui font-semibold">Who can see it?</span>
        <AccessFields value={access} onChange={setAccess} groups={groups} people={people} meId={meId} />
      </div>
      <ReasonField value={reason} onChange={setReason} placeholder="e.g. personal contact data is need-to-know" />
    </Shell>
  );
}

/* ── Stop protecting ──────────────────────────────────────────────────────── */

function UnprotectDialog({
  open,
  columns,
  tagById,
  onClose,
  onDone,
}: {
  open: boolean;
  columns: Row[];
  tagById: Map<string, DataTag>;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit(async () => {
    needReason(reason);
    for (const c of columns) {
      for (const tagId of c.tagIds) {
        await send('/api/access/column-tags', 'DELETE', { tablePath: c.tablePath, column: c.column, tagId, reason: reason.trim() });
      }
    }
    setReason('');
    await onDone(`${plural(columns.length, 'column')} no longer protected.`);
  });

  return (
    <Shell
      open={open}
      onClose={onClose}
      title={`Stop protecting ${plural(columns.length, 'column')}?`}
      subtitle={<ColumnList columns={columns} />}
      footer={<FooterButtons busy={busy} error={error} label="Stop protecting" danger onCancel={onClose} onSave={() => void run()} />}
    >
      <p className="text-size-ui">
        Everyone who can open these tables will see the real values again (
        {[...new Set(columns.flatMap((c) => c.tagIds.map((id) => tagById.get(id)?.name)))].filter(Boolean).join(', ')}).
      </p>
      <ReasonField value={reason} onChange={setReason} placeholder="e.g. column holds grade codes, not pay" />
    </Shell>
  );
}

/* ── Who can see one kind of data: people, groups, and giving access ─────── */

function ProtectionDialog({
  tag,
  columnCount,
  grants,
  groups,
  people,
  meId,
  readOnly,
  isPlatformAdmin,
  onClose,
  onChanged,
}: {
  tag: DataTag | null;
  columnCount: number;
  grants: TagGrant[];
  groups: AccessGroup[];
  people: Person[];
  meId: string;
  readOnly: boolean;
  isPlatformAdmin: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState<string | null>(null); // group id being added to
  const [giving, setGiving] = useState(false);

  if (!tag) return null;

  const personGrants = grants.filter((g) => g.principalType === 'user');
  const groupGrants = grants.filter((g) => g.principalType === 'group');
  const grantedGroupIds = new Set(groupGrants.map((g) => g.principalId));
  const close = () => {
    setAdding(null);
    setGiving(false);
    onClose();
  };
  const levelText = (g: TagGrant) => (g.level === 'aggregate' ? 'Totals only' : 'Exact values');
  const until = (iso: string | null) => (iso ? `until ${new Date(iso).toLocaleDateString()}` : 'no end date');

  return (
    <Shell
      open
      onClose={close}
      title={`Who can see ${tag.name}`}
      subtitle={`${plural(columnCount, 'protected column')}. Everyone else sees ••• and can request access.`}
    >
      {!readOnly && isPlatformAdmin ? (
        giving ? (
          <GiveAccessPanel
            tag={tag}
            groups={groups.filter((g) => !grantedGroupIds.has(g.id))}
            people={people}
            meId={meId}
            alreadyPeople={personGrants.map((g) => g.principalId)}
            onCancel={() => setGiving(false)}
            onDone={async () => {
              setGiving(false);
              await onChanged();
            }}
          />
        ) : (
          <button type="button" className={cn(userStyles.primary, 'inline-flex items-center gap-1.5 self-start')} onClick={() => setGiving(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Give access
          </button>
        )
      ) : null}

      {grants.length === 0 ? (
        <p className="text-caption text-muted-foreground">Nobody yet, so these columns are masked for everyone.</p>
      ) : null}

      {personGrants.length ? (
        <section className="rounded-[10px] border border-[var(--estate-border)]" aria-label="People">
          <header className="flex items-center gap-2 border-b border-[var(--estate-border)] px-3 py-2">
            <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-semibold">People</span>
          </header>
          <ul className="divide-y divide-[var(--estate-border)]">
            {personGrants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span>{personName(people.find((p) => p.id === g.principalId), 'Unknown person')}</span>
                <span className={s.chip}>{levelText(g)}</span>
                <span className="text-caption text-muted-foreground">{until(g.expiresAt)}</span>
                {!readOnly ? <RemoveButton label="Remove" onRemove={() => send('/api/access/tag-grants', 'DELETE', { id: g.id }).then(onChanged)} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groupGrants.map((g) => {
        const grp = groups.find((x) => x.id === g.principalId);
        if (!grp) return null;
        const isOwner = grp.owners.some((o) => o.userId === meId);
        const canAdd = isPlatformAdmin || isOwner;
        const canRemove = canAdd || !readOnly;
        return (
          <section key={g.id} className="rounded-[10px] border border-[var(--estate-border)]" aria-label={grp.name}>
            <header className="flex flex-wrap items-center gap-2 border-b border-[var(--estate-border)] px-3 py-2">
              <UsersRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-semibold">{grp.name}</span>
              <span className={s.chip}>{levelText(g)}</span>
              <span className="text-caption text-muted-foreground">
                Approver: {grp.owners.map((o) => personName({ name: o.name, email: o.email ?? o.userId })).join(', ')}
              </span>
              {!readOnly ? (
                <RemoveButton label="Remove group" onRemove={() => send('/api/access/tag-grants', 'DELETE', { id: g.id }).then(onChanged)} />
              ) : null}
            </header>
            <ul className="divide-y divide-[var(--estate-border)]">
              {activeMembers(grp).length === 0 ? (
                <li className="px-3 py-2 text-caption text-muted-foreground">No people in this group yet.</li>
              ) : (
                activeMembers(grp).map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span>{personName({ name: m.name, email: m.email ?? m.userId })}</span>
                    <span className="text-caption text-muted-foreground">{until(m.expiresAt)}</span>
                    {canRemove ? (
                      <RemoveButton label="Remove" onRemove={() => send(`/api/access/groups/${grp.id}/members`, 'DELETE', { userId: m.userId }).then(onChanged)} />
                    ) : null}
                  </li>
                ))
              )}
            </ul>
            {canAdd ? (
              adding === grp.id ? (
                <AddPeopleToGroup
                  group={grp}
                  people={people}
                  meId={meId}
                  onCancel={() => setAdding(null)}
                  onDone={async () => {
                    setAdding(null);
                    await onChanged();
                  }}
                />
              ) : (
                <button type="button" className={cn(s.linkBtn, 'm-3 inline-flex items-center gap-1')} onClick={() => setAdding(grp.id)}>
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add people to {grp.name}
                </button>
              )
            ) : null}
          </section>
        );
      })}
    </Shell>
  );
}

function GiveAccessPanel({
  tag,
  groups,
  people,
  meId,
  alreadyPeople,
  onCancel,
  onDone,
}: {
  tag: DataTag;
  groups: AccessGroup[];
  people: Person[];
  meId: string;
  alreadyPeople: string[];
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [access, setAccess] = useState<AccessChoice>(() => emptyChoice(groups));
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit(async () => {
    const problem = choiceProblem(access);
    if (problem) throw new Error(problem);
    needReason(reason);
    await applyAccess(tag.id, access, reason.trim(), people);
    await onDone();
  });
  return (
    <div className="flex flex-col gap-4 rounded-[10px] bg-[var(--surface-2)] p-3">
      <span className="text-size-ui font-semibold">Give access to {tag.name}</span>
      <AccessFields value={access} onChange={setAccess} groups={groups} people={people} meId={meId} excludePeople={alreadyPeople} />
      <ReasonField value={reason} onChange={setReason} placeholder="e.g. payroll processing" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={userStyles.primary} disabled={busy} onClick={() => void run()}>
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

function AddPeopleToGroup({
  group,
  people,
  meId,
  onCancel,
  onDone,
}: {
  group: AccessGroup;
  people: Person[];
  meId: string;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<Duration>('30');
  const { busy, error, run } = useSubmit(async () => {
    if (ids.length === 0) throw new Error('Pick at least one person');
    for (const userId of ids) {
      await send(`/api/access/groups/${group.id}/members`, 'POST', { userId, expiresAt: expiryFor(duration) });
    }
    await onDone();
  });
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--estate-border)] bg-[var(--surface-2)] p-3">
      <PeoplePicker
        label="People to add"
        people={people}
        value={ids}
        onChange={setIds}
        exclude={[meId, ...activeMembers(group).map((m) => m.userId)]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">For</span>
        <Segmented<Duration> ariaLabel="How long" options={DURATIONS} value={duration} onChange={setDuration} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={userStyles.primary} disabled={busy} onClick={() => void run()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className={userStyles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className={s.errorText} role="alert">{error}</span> : null}
      </div>
      <p className="text-caption text-muted-foreground">You can't add yourself.</p>
    </div>
  );
}

/** "Remove" with a quick "Sure?"; it only narrows access and can be undone by adding it again. */
function RemoveButton({ label, onRemove }: { label: string; onRemove: () => Promise<unknown> }) {
  return <ConfirmButton label={label} className="ml-auto" onConfirm={onRemove} />;
}
