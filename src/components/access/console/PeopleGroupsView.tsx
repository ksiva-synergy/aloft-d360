'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Plus, Search, ShieldCheck, UserPlus, UsersRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, keyFromName, personName, runAsync, send, type AccessGroup, type DataTag, type Person } from './api';
import { GroupDepartments } from './GroupDepartments';
import { DURATIONS, PeoplePicker, expiryFor, type Duration } from './GiveAccess';
import { ConfirmButton, Empty, Segmented, SplitPane } from './parts';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

/* ─────────────────────────────────────────────────────────────────────────────
 * People & groups (simplified model).
 *   Left:  Groups | People switch with search; both lists are browsable (+ New group).
 *   Right: a group (approvers, members, what it can use and see) or a person (their groups and
 *          built-in groups, what they can use, which protections they hold, and through what).
 * ──────────────────────────────────────────────────────────────────────────── */

type Rule = { id: string; holderName: string; path: string; access: 'use' | 'export' | 'block'; expiresAt: string | null };
type PersonInfo = {
  person: { id: string; email: string; name: string | null; roles: string[] };
  groups: { id: string; name: string; expiresAt: string | null }[];
  builtins: { id: string; name: string }[];
  rules: { path: string; access: 'use' | 'export' | 'block'; through: string; expiresAt: string | null }[];
  protections: { id: string; name: string; level: 'full' | 'aggregate' | 'none'; through: string[] }[];
};
type Selection = { kind: 'group'; id: string } | { kind: 'person'; id: string } | { kind: 'new' } | null;

const ACCESS_LABEL = { use: 'Use', export: 'Use + export', block: 'Block' } as const;
const LEVEL_LABEL = { full: 'Exact values', aggregate: 'Totals only', none: 'No access' } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Tab = 'groups' | 'people';
const PEOPLE_CAP = 150;

const initials = (label: string) => {
  const parts = label.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
};

function Avatar({ label, large, group }: { label: string; large?: boolean; group?: boolean }) {
  return (
    <span className={cn(s.pgAvatar, large && s.pgAvatarLg)} aria-hidden="true">
      {group ? <UsersRound className={large ? 'h-5 w-5' : 'h-4 w-4'} /> : initials(label)}
    </span>
  );
}

function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input className={cn(userStyles.input, s.protectCompactInput, '!pl-8')} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
    </div>
  );
}

const expiryChip = (expired: boolean | undefined, expiresAt: string | null) =>
  expired ? (
    <span className={cn(s.chip, s.chipBad)}>Expired</span>
  ) : expiresAt ? (
    <span className={s.chip} title="Membership ends on this date">
      Until {new Date(expiresAt).toLocaleDateString()}
    </span>
  ) : null;

export function PeopleGroupsView({
  people,
  meId,
  isPlatformAdmin,
  focusUserId,
  onChanged,
}: {
  people: Person[];
  meId: string;
  isPlatformAdmin: boolean;
  /** Open this person (links from the Users page). */
  focusUserId?: string | null;
  onChanged: () => Promise<void> | void;
}) {
  const readOnly = useConsoleReadOnly();
  const [groups, setGroups] = useState<AccessGroup[] | null>(null);
  const [tags, setTags] = useState<DataTag[]>([]);
  const [sel, setSel] = useState<Selection>(focusUserId ? { kind: 'person', id: focusUserId } : null);
  const [tab, setTab] = useState<Tab>(focusUserId ? 'people' : 'groups');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [g, t] = await Promise.all([accessFetch<{ groups: AccessGroup[] }>('/api/access/groups'), accessFetch<{ tags: DataTag[] }>('/api/access/tags')]);
    setGroups(g.groups);
    setTags(t.tags);
    setSel((cur) => cur ?? (g.groups[0] ? { kind: 'group', id: g.groups[0].id } : null));
  }, []);
  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load groups')));
  }, [load]);

  const refresh = async () => {
    await Promise.all([load(), onChanged()]);
  };
  const group = sel?.kind === 'group' ? (groups ?? []).find((g) => g.id === sel.id) ?? null : null;

  const q = query.trim().toLowerCase();
  const shownGroups = useMemo(
    () =>
      (groups ?? []).filter(
        (g) => !q || `${g.name} ${g.owners.map((o) => `${o.name ?? ''} ${o.email ?? ''}`).join(' ')}`.toLowerCase().includes(q),
      ),
    [groups, q],
  );
  const matchedPeople = useMemo(
    () =>
      people
        .filter((p) => !q || `${p.name ?? ''} ${p.email}`.toLowerCase().includes(q))
        .sort((a, b) => personName(a).localeCompare(personName(b))),
    [people, q],
  );
  const shownPeople = matchedPeople.slice(0, PEOPLE_CAP);

  const openGroup = (id: string) => {
    setTab('groups');
    setQuery('');
    setSel({ kind: 'group', id });
  };

  return (
    <SplitPane>
      <aside className={s.listPane} aria-label="Groups and people">
        <div className={s.listHead}>
          <Segmented<Tab>
            ariaLabel="Browse"
            value={tab}
            onChange={(v) => {
              setTab(v);
              setQuery('');
            }}
            options={[
              { value: 'groups', label: `Groups${groups ? ` ${groups.length}` : ''}` },
              { value: 'people', label: `People ${people.length}` },
            ]}
          />
          <SearchBox
            value={query}
            onChange={setQuery}
            label={tab === 'groups' ? 'Search groups' : 'Search people'}
            placeholder={tab === 'groups' ? 'Search groups or approvers' : 'Name or email'}
          />
          {tab === 'groups' && !readOnly ? (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-[10px] border border-dashed border-[var(--brand-a)] px-3 py-1.5 text-size-ui font-medium text-[var(--brand-a-ink)] hover:bg-[var(--brand-a-soft)]"
              onClick={() => setSel({ kind: 'new' })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New group
            </button>
          ) : null}
        </div>
        <div className={cn(s.listBody, 'compact-scroll')}>
          {error ? <p className={cn(s.errorText, 'p-2')}>{error}</p> : null}
          {tab === 'groups' ? (
            groups === null ? (
              <p className="p-3 text-caption text-muted-foreground">Loading…</p>
            ) : shownGroups.length === 0 ? (
              <p className="p-3 text-caption text-muted-foreground">{groups.length === 0 ? 'No groups yet.' : 'No group matches.'}</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {shownGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={cn(s.pgRow, sel?.kind === 'group' && sel.id === g.id && s.pgRowActive)}
                    onClick={() => setSel({ kind: 'group', id: g.id })}
                  >
                    <Avatar label={g.name} group />
                    <span className="min-w-0">
                      <span className={s.pgRowTitle}>{g.name}</span>
                      <span className={s.pgRowSub}>Approver: {g.owners.map((o) => personName({ name: o.name, email: o.email ?? o.userId })).join(', ') || 'none'}</span>
                    </span>
                    <span className={s.navCount} title="Members">{g.members.filter((m) => !m.expired).length}</span>
                  </button>
                ))}
              </div>
            )
          ) : matchedPeople.length === 0 ? (
            <p className="p-3 text-caption text-muted-foreground">Nobody matches.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {shownPeople.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={cn(s.pgRow, sel?.kind === 'person' && sel.id === p.id && s.pgRowActive)}
                  onClick={() => setSel({ kind: 'person', id: p.id })}
                >
                  <Avatar label={personName(p)} />
                  <span className="min-w-0">
                    <span className={s.pgRowTitle}>
                      {personName(p)}
                      {p.id === meId ? ' (you)' : ''}
                    </span>
                    <span className={s.pgRowSub}>{p.email}</span>
                  </span>
                  {p.platformAdmin ? (
                    <span title="Platform admin" className="text-[var(--ok)]">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  ) : null}
                </button>
              ))}
              {matchedPeople.length > shownPeople.length ? (
                <p className="p-2 text-caption text-muted-foreground">
                  Showing {shownPeople.length} of {matchedPeople.length}. Search to narrow.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </aside>

      <section className={cn(s.detailPane, 'min-w-0')}>
        {sel?.kind === 'new' ? (
          <NewGroup
            people={people}
            meId={meId}
            onCancel={() => setSel(null)}
            onDone={async (id) => {
              await refresh();
              openGroup(id);
            }}
          />
        ) : sel?.kind === 'person' ? (
          <PersonDetail key={sel.id} userId={sel.id} onOpenGroup={openGroup} />
        ) : group ? (
          <GroupDetail key={group.id} group={group} tags={tags} people={people} meId={meId} readOnly={readOnly} isPlatformAdmin={isPlatformAdmin} onChanged={refresh} />
        ) : (
          <Empty icon={<UsersRound className="h-5 w-5" aria-hidden="true" />}>Pick a group or a person, or create a new group.</Empty>
        )}
      </section>
    </SplitPane>
  );
}

/* ── Group ────────────────────────────────────────────────────────────────── */

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className={s.pgStat}>
      <span className="text-title-section font-semibold leading-none">{value}</span>
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

function GroupDetail({
  group,
  tags,
  people,
  meId,
  readOnly,
  isPlatformAdmin,
  onChanged,
}: {
  group: AccessGroup;
  tags: DataTag[];
  people: Person[];
  meId: string;
  readOnly: boolean;
  isPlatformAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingOwner, setAddingOwner] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const isOwner = group.owners.some((o) => o.userId === meId);
  const canAdd = isPlatformAdmin || isOwner;
  const canRemove = canAdd || !readOnly;
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const active = group.members.filter((m) => !m.expired).length;
  const mq = memberQuery.trim().toLowerCase();
  const members = group.members.filter((m) => !mq || `${m.name ?? ''} ${m.email ?? ''}`.toLowerCase().includes(mq));

  useEffect(() => {
    runAsync(async () => {
      const r = await accessFetch<{ rules: Rule[] }>(`/api/access/rules?holderType=group&holderId=${encodeURIComponent(group.id)}`);
      setRules(r.rules);
    });
  }, [group.id]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <Avatar label={group.name} large group />
        <div className="min-w-0 flex-1">
          <h2 className="text-title-section">{group.name}</h2>
          <p className="text-caption text-muted-foreground">{group.description || 'Group of people who share the same data access.'}</p>
        </div>
        {canAdd && !adding ? (
          <button type="button" className={cn(userStyles.primary, 'inline-flex items-center gap-1.5')} onClick={() => setAdding(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add people
          </button>
        ) : null}
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat value={active} label="People" />
        <Stat value={group.owners.length} label={group.owners.length === 1 ? 'Approver' : 'Approvers'} />
        <Stat value={rules === null ? '…' : rules.length + group.grants.length} label="Access rules" />
      </div>

      <section className={s.card} aria-label="Members">
        <div className={s.cardHead}>
          <div>
            <h3 className={s.cardTitle}>Members ({active})</h3>
            <p className={s.cardHint}>The approver and platform admins add people. Nobody adds themselves.</p>
          </div>
          {group.members.length > 8 ? (
            <div className="w-48">
              <SearchBox value={memberQuery} onChange={setMemberQuery} label="Search members" placeholder="Search members" />
            </div>
          ) : null}
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-2')}>
          {adding ? (
            <AddMembers
              group={group}
              people={people}
              meId={meId}
              onCancel={() => setAdding(false)}
              onDone={async () => {
                setAdding(false);
                await onChanged();
              }}
            />
          ) : null}
          {group.members.length === 0 ? (
            <p className="text-caption text-muted-foreground">No members yet.</p>
          ) : members.length === 0 ? (
            <p className="text-caption text-muted-foreground">No member matches.</p>
          ) : (
            <ul className="divide-y divide-[var(--estate-border)]">
              {members.map((m) => {
                const nm = personName({ name: m.name, email: m.email ?? m.userId });
                return (
                  <li key={m.userId} className={cn(s.pgMember, m.expired && 'opacity-60')}>
                    <Avatar label={nm} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-size-ui font-medium">{nm}</p>
                      {m.email && m.email !== nm ? <p className="truncate text-caption text-muted-foreground">{m.email}</p> : null}
                    </div>
                    {expiryChip(m.expired, m.expiresAt)}
                    {canRemove ? (
                      <ConfirmButton label="Remove" onConfirm={() => send(`/api/access/groups/${group.id}/members`, 'DELETE', { userId: m.userId }).then(onChanged)} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className={s.card} aria-label="Approvers">
        <div className={s.cardHead}>
          <div>
            <h3 className={s.cardTitle}>Approver</h3>
            <p className={s.cardHint}>Approves requests to join. One is enough; only a platform admin changes approvers.</p>
          </div>
          {!readOnly && isPlatformAdmin && !addingOwner ? (
            <button type="button" className={userStyles.secondaryButton} onClick={() => setAddingOwner(true)}>
              Add approver
            </button>
          ) : null}
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-2')}>
          {addingOwner ? (
            <AddOwner
              group={group}
              people={people}
              onCancel={() => setAddingOwner(false)}
              onDone={async () => {
                setAddingOwner(false);
                await onChanged();
              }}
            />
          ) : null}
          <ul className="divide-y divide-[var(--estate-border)]">
            {group.owners.map((o) => {
              const nm = personName({ name: o.name, email: o.email ?? o.userId });
              return (
                <li key={o.userId} className={s.pgMember}>
                  <Avatar label={nm} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-size-ui font-medium">{nm}</p>
                    {o.email && o.email !== nm ? <p className="truncate text-caption text-muted-foreground">{o.email}</p> : null}
                  </div>
                  {o.userId === meId ? <span className={s.chip}>You</span> : null}
                  {!readOnly && isPlatformAdmin && group.owners.length > 1 ? (
                    <ConfirmButton label="Remove" onConfirm={() => send(`/api/access/groups/${group.id}/owners`, 'DELETE', { userId: o.userId }).then(onChanged)} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <GroupDepartments group={group} readOnly={readOnly} onChanged={onChanged} />

      <section className={s.card} aria-label="What this group can use and see">
        <div className={s.cardHead}>
          <div>
            <h3 className={s.cardTitle}>What it can use and see</h3>
            <p className={s.cardHint}>Change data access from the Data tab, and protections from the Protections tab.</p>
          </div>
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-1.5')}>
          {rules === null ? (
            <p className="text-caption text-muted-foreground">Loading…</p>
          ) : rules.length === 0 && group.grants.length === 0 ? (
            <p className="text-caption text-muted-foreground">Nothing yet.</p>
          ) : null}
          {(rules ?? []).map((r) => (
            <p key={r.id} className={s.pgRule}>
              <span className={cn(s.chip, r.access === 'block' ? s.chipBad : r.access === 'export' ? s.chipBrand : s.chipOk)}>{ACCESS_LABEL[r.access]}</span>
              <code className="min-w-0 flex-1 truncate" title={r.path}>{r.path}</code>
            </p>
          ))}
          {group.grants.map((g) => (
            <p key={g.id} className={s.pgRule}>
              <span className={cn(s.chip, s.chipBrand)}>
                <Lock className="h-3 w-3" aria-hidden="true" />
                Sees
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{tagName.get(g.tagId) ?? '…'}</span> · {LEVEL_LABEL[g.level]}
              </span>
            </p>
          ))}
        </div>
      </section>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-[var(--estate-border)] px-4 py-3">
          <p className="min-w-0 flex-1 text-caption text-muted-foreground">Archiving removes the group and everything it grants. It is kept in the audit log.</p>
          <WithReason
            label={`Archive ${group.name}`}
            danger
            onConfirm={(reason) => send(`/api/access/groups/${group.id}`, 'DELETE', { reason }).then(onChanged)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function AddMembers({ group, people, meId, onCancel, onDone }: { group: AccessGroup; people: Person[]; meId: string; onCancel: () => void; onDone: () => Promise<void> }) {
  const [ids, setIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<Duration>('none');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-[var(--surface-2)] p-3">
      <PeoplePicker label="People" people={people} value={ids} onChange={setIds} exclude={[meId, ...group.members.filter((m) => !m.expired).map((m) => m.userId)]} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">For</span>
        <Segmented<Duration> ariaLabel="How long" options={DURATIONS} value={duration} onChange={setDuration} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={userStyles.primary}
          disabled={busy}
          onClick={async () => {
            if (!ids.length) return setError('Pick at least one person');
            setBusy(true);
            setError(null);
            try {
              for (const userId of ids) await send(`/api/access/groups/${group.id}/members`, 'POST', { userId, expiresAt: expiryFor(duration) });
              await onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not add');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className={userStyles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className={s.errorText} role="alert">{error}</span> : null}
      </div>
    </div>
  );
}

function AddOwner({ group, people, onCancel, onDone }: { group: AccessGroup; people: Person[]; onCancel: () => void; onDone: () => Promise<void> }) {
  const [id, setId] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--surface-2)] p-3">
      <PeoplePicker label="Approver" single people={people} value={id} onChange={setId} exclude={group.owners.map((o) => o.userId)} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={userStyles.primary}
          onClick={async () => {
            if (!id[0]) return setError('Pick a person');
            try {
              await send(`/api/access/groups/${group.id}/owners`, 'POST', { userId: id[0] });
              await onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not add');
            }
          }}
        >
          Add approver
        </button>
        <button type="button" className={userStyles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className={s.errorText}>{error}</span> : null}
      </div>
    </div>
  );
}

function NewGroup({ people, meId, onCancel, onDone }: { people: Person[]; meId: string; onCancel: () => void; onDone: (id: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [approver, setApprover] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <header>
        <p className="text-eyebrow uppercase text-muted-foreground">New group</p>
        <h2 className="text-title-section">Create a group of people</h2>
      </header>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium">Name</span>
        <Input className={userStyles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marine, Payroll team" aria-label="Group name" />
      </label>
      <PeoplePicker label="Approver" single people={people} value={approver} onChange={setApprover} placeholder="Who approves requests to join" />
      <PeoplePicker label="People in the group" people={people} value={members} onChange={setMembers} exclude={[meId]} placeholder="Add people now (optional)" />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={userStyles.primary}
          disabled={busy}
          onClick={async () => {
            if (name.trim().length < 2) return setError('Name the group');
            if (!approver[0]) return setError('Pick an approver');
            setBusy(true);
            setError(null);
            try {
              const g = await send<{ group: { id: string } }>('/api/access/groups', 'POST', { key: keyFromName(name), name: name.trim(), ownerIds: [approver[0]] });
              for (const userId of members) await send(`/api/access/groups/${g.group.id}/members`, 'POST', { userId });
              await onDone(g.group.id);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not create');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Creating…' : 'Create group'}
        </button>
        <button type="button" className={userStyles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className={s.errorText} role="alert">{error}</span> : null}
      </div>
      <p className="text-caption text-muted-foreground">Then give the group access from the Data tab, or a protection from the Protections tab.</p>
    </div>
  );
}

/* ── Person ───────────────────────────────────────────────────────────────── */

function PersonDetail({ userId, onOpenGroup }: { userId: string; onOpenGroup: (id: string) => void }) {
  const [info, setInfo] = useState<PersonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    runAsync(async () => {
      try {
        setInfo(await accessFetch<PersonInfo>(`/api/access/person?userId=${encodeURIComponent(userId)}`));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load');
      }
    });
  }, [userId]);
  if (error) return <p className={s.errorText}>{error}</p>;
  if (!info) return <p className="text-caption text-muted-foreground">Loading…</p>;
  const held = info.protections.filter((p) => p.level !== 'none');
  const missing = info.protections.filter((p) => p.level === 'none');
  const usable = info.rules.filter((r) => r.access !== 'block').length;
  const name = personName(info.person);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <Avatar label={name} large />
        <div className="min-w-0 flex-1">
          <h2 className="text-title-section">{name}</h2>
          <p className="text-caption text-muted-foreground">
            {info.person.email} · app role {info.person.roles.join(', ')}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat value={info.groups.length + info.builtins.length} label="Groups" />
        <Stat value={usable} label="Data rules" />
        <Stat value={held.length} label="Protections held" />
      </div>

      <section className={s.card} aria-label="Groups">
        <div className={s.cardHead}>
          <h3 className={s.cardTitle}>Groups</h3>
        </div>
        <div className={cn(s.cardBody, 'flex flex-wrap gap-1.5')}>
          {info.builtins.map((b) => (
            <span key={b.id} className={s.chip} title="Built-in, from the app role">
              {b.name}
            </span>
          ))}
          {info.groups.map((g) => (
            <button key={g.id} type="button" className={cn(s.chip, s.chipBrand, 'cursor-pointer hover:brightness-95')} title={`Open ${g.name}`} onClick={() => onOpenGroup(g.id)}>
              {g.name}
              {g.expiresAt ? ` · until ${new Date(g.expiresAt).toLocaleDateString()}` : ''}
            </button>
          ))}
          {info.groups.length === 0 && info.builtins.length === 0 ? <span className="text-caption text-muted-foreground">None</span> : null}
        </div>
      </section>

      <section className={s.card} aria-label="Can use">
        <div className={s.cardHead}>
          <h3 className={s.cardTitle}>Can use ({plural(usable, 'rule')})</h3>
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-1.5')}>
          {info.rules.length === 0 ? <p className="text-caption text-muted-foreground">No data yet.</p> : null}
          {info.rules.map((r, i) => (
            <p key={i} className={s.pgRule}>
              <span className={cn(s.chip, r.access === 'block' ? s.chipBad : r.access === 'export' ? s.chipBrand : s.chipOk)}>{ACCESS_LABEL[r.access]}</span>
              <code className="min-w-0 flex-1 truncate" title={r.path}>{r.path}</code>
              <span className="shrink-0 text-caption text-muted-foreground">· {r.through}</span>
            </p>
          ))}
        </div>
      </section>

      <section className={s.card} aria-label="Protected data">
        <div className={s.cardHead}>
          <h3 className={s.cardTitle}>Protected data</h3>
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-1.5')}>
          {held.map((p) => (
            <p key={p.id} className={s.pgRule}>
              <span className={cn(s.chip, s.chipBrand)}>
                <Lock className="h-3 w-3" aria-hidden="true" />
                {p.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-caption">{LEVEL_LABEL[p.level]}</span>
              <span className="shrink-0 text-caption text-muted-foreground">· {p.through.join(', ')}</span>
            </p>
          ))}
          {missing.length ? <p className="text-caption text-muted-foreground">Sees ••• for: {missing.map((p) => p.name).join(', ')}</p> : null}
          {info.protections.length === 0 ? <p className="text-caption text-muted-foreground">No protections exist yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

/* ── Small helper ─────────────────────────────────────────────────────────── */

function WithReason({ label, danger, onConfirm }: { label: string; danger?: boolean; onConfirm: (reason: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className={cn(s.linkBtn, 'ml-auto', danger && 'text-[var(--bad)]')} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="ml-auto inline-flex flex-wrap items-center gap-1">
      <Input className={cn(userStyles.input, 'h-8 w-48')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" aria-label="Reason" autoFocus />
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
