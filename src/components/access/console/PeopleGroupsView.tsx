'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, Plus, User, UserPlus, UsersRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, keyFromName, personName, runAsync, send, type AccessGroup, type DataTag, type Person } from './api';
import { DURATIONS, PeoplePicker, expiryFor, type Duration } from './GiveAccess';
import { Empty, Segmented } from './parts';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

/* ─────────────────────────────────────────────────────────────────────────────
 * People & groups (simplified model).
 *   Left:  groups (with + New group), then "Look up a person".
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
  const [personPick, setPersonPick] = useState<string[]>(focusUserId ? [focusUserId] : []);
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

  return (
    <div className={cn(s.split, 'min-h-[560px]')}>
      <aside className={s.listPane} aria-label="Groups and people">
        <div className={s.listHead}>
          <span className="text-eyebrow uppercase text-muted-foreground">Groups</span>
          {readOnly ? null : (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-[10px] border border-dashed border-[var(--brand-a)] px-3 py-2 text-size-ui font-medium text-[var(--brand-a-ink)] hover:bg-[var(--brand-a-soft)]"
              onClick={() => setSel({ kind: 'new' })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New group
            </button>
          )}
        </div>
        <div className={cn(s.listBody, 'compact-scroll')}>
          {error ? <p className={cn(s.errorText, 'p-2')}>{error}</p> : null}
          {groups === null ? (
            <p className="p-3 text-caption text-muted-foreground">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="p-3 text-caption text-muted-foreground">No groups yet.</p>
          ) : (
            groups.map((g) => (
              <button
                key={g.id}
                type="button"
                className={cn(s.listItem, sel?.kind === 'group' && sel.id === g.id && s.listItemActive)}
                onClick={() => setSel({ kind: 'group', id: g.id })}
              >
                <span className={s.listItemTitle}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <UsersRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{g.name}</span>
                  </span>
                  <span className={s.navCount}>{g.members.filter((m) => !m.expired).length}</span>
                </span>
                <span className={cn(s.listItemSub, 'truncate')}>Approver: {g.owners.map((o) => personName({ name: o.name, email: o.email ?? o.userId })).join(', ') || 'none'}</span>
              </button>
            ))
          )}
          <div className="mt-3 border-t border-[var(--estate-border)] p-2">
            <PeoplePicker
              label="Look up a person"
              single
              people={people}
              value={personPick}
              onChange={(ids) => {
                setPersonPick(ids);
                if (ids[0]) setSel({ kind: 'person', id: ids[0] });
              }}
              placeholder="Name or email"
            />
          </div>
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
              setSel({ kind: 'group', id });
            }}
          />
        ) : sel?.kind === 'person' ? (
          <PersonDetail key={sel.id} userId={sel.id} />
        ) : group ? (
          <GroupDetail key={group.id} group={group} tags={tags} people={people} meId={meId} readOnly={readOnly} isPlatformAdmin={isPlatformAdmin} onChanged={refresh} />
        ) : (
          <Empty icon={<UsersRound className="h-5 w-5" aria-hidden="true" />}>Pick a group, create one, or look up a person.</Empty>
        )}
      </section>
    </div>
  );
}

/* ── Group ────────────────────────────────────────────────────────────────── */

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
  const isOwner = group.owners.some((o) => o.userId === meId);
  const canAdd = isPlatformAdmin || isOwner;
  const canRemove = canAdd || !readOnly;
  const tagName = new Map(tags.map((t) => [t.id, t.name]));

  useEffect(() => {
    runAsync(async () => {
      const r = await accessFetch<{ rules: Rule[] }>(`/api/access/rules?holderType=group&holderId=${encodeURIComponent(group.id)}`);
      setRules(r.rules);
    });
  }, [group.id]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-eyebrow uppercase text-muted-foreground">Group</p>
        <h2 className="text-title-section">{group.name}</h2>
        {group.description ? <p className="text-caption text-muted-foreground">{group.description}</p> : null}
      </header>

      <section className={s.card} aria-label="Members">
        <div className={s.cardHead}>
          <div>
            <h3 className={s.cardTitle}>Members ({group.members.filter((m) => !m.expired).length})</h3>
            <p className={s.cardHint}>The approver and platform admins add people. Nobody adds themselves.</p>
          </div>
          {canAdd ? (
            <button type="button" className={cn(userStyles.primary, 'inline-flex items-center gap-1.5')} onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add people
            </button>
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
          ) : (
            <ul className="divide-y divide-[var(--estate-border)]">
              {group.members.map((m) => (
                <li key={m.userId} className={cn('flex flex-wrap items-center gap-2 py-1.5', m.expired && 'opacity-60')}>
                  <span>{personName({ name: m.name, email: m.email ?? m.userId })}</span>
                  <span className="text-caption text-muted-foreground">{m.expired ? 'expired' : m.expiresAt ? `until ${new Date(m.expiresAt).toLocaleDateString()}` : 'no end date'}</span>
                  {canRemove ? (
                    <WithReason label="Remove" onConfirm={(reason) => send(`/api/access/groups/${group.id}/members`, 'DELETE', { userId: m.userId, reason }).then(onChanged)} />
                  ) : null}
                </li>
              ))}
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
          {!readOnly && isPlatformAdmin ? (
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
          {group.owners.map((o) => (
            <div key={o.userId} className="flex flex-wrap items-center gap-2">
              <span>{personName({ name: o.name, email: o.email ?? o.userId })}</span>
              {o.userId === meId ? <span className={s.chip}>You</span> : null}
              {!readOnly && isPlatformAdmin && group.owners.length > 1 ? (
                <WithReason label="Remove" onConfirm={(reason) => send(`/api/access/groups/${group.id}/owners`, 'DELETE', { userId: o.userId, reason }).then(onChanged)} />
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className={s.card} aria-label="What this group can use and see">
        <div className={s.cardHead}>
          <div>
            <h3 className={s.cardTitle}>What it can use and see</h3>
            <p className={s.cardHint}>Change data access from the Data tab, and protections from the Protections tab.</p>
          </div>
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-1')}>
          {rules === null ? (
            <p className="text-caption text-muted-foreground">Loading…</p>
          ) : rules.length === 0 && group.grants.length === 0 ? (
            <p className="text-caption text-muted-foreground">Nothing yet.</p>
          ) : null}
          {(rules ?? []).map((r) => (
            <p key={r.id} className="text-caption">
              <span className={cn('font-medium', r.access === 'block' && 'text-[var(--bad)]')}>{ACCESS_LABEL[r.access]}</span> <code>{r.path}</code>
            </p>
          ))}
          {group.grants.map((g) => (
            <p key={g.id} className="text-caption">
              <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />
              Sees <span className="font-medium">{tagName.get(g.tagId) ?? '…'}</span> · {LEVEL_LABEL[g.level]}
            </p>
          ))}
        </div>
      </section>

      {!readOnly ? (
        <div>
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

function AddMembers({ group, people, meId, onCancel, onDone }: { group: AccessGroup; people: Person[]; meId: string; onCancel: () => void; onDone: () => Promise<void> }) {
  const [ids, setIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<Duration>('none');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-[var(--surface-2)] p-3">
      <PeoplePicker label="People" people={people} value={ids} onChange={setIds} exclude={[meId, ...group.members.filter((m) => !m.expired).map((m) => m.userId)]} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">For</span>
        <Segmented<Duration> ariaLabel="How long" options={DURATIONS} value={duration} onChange={setDuration} />
      </div>
      <Input className={userStyles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the audit log)" aria-label="Reason" />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={userStyles.primary}
          disabled={busy}
          onClick={async () => {
            if (!ids.length) return setError('Pick at least one person');
            if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
            setBusy(true);
            setError(null);
            try {
              for (const userId of ids) await send(`/api/access/groups/${group.id}/members`, 'POST', { userId, expiresAt: expiryFor(duration), reason: reason.trim() });
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
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--surface-2)] p-3">
      <PeoplePicker label="Approver" single people={people} value={id} onChange={setId} exclude={group.owners.map((o) => o.userId)} />
      <Input className={userStyles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason" />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={userStyles.primary}
          onClick={async () => {
            if (!id[0]) return setError('Pick a person');
            if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
            try {
              await send(`/api/access/groups/${group.id}/owners`, 'POST', { userId: id[0], reason: reason.trim() });
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
  const [reason, setReason] = useState('');
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
      <Input className={userStyles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the audit log)" aria-label="Reason" />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={userStyles.primary}
          disabled={busy}
          onClick={async () => {
            if (name.trim().length < 2) return setError('Name the group');
            if (!approver[0]) return setError('Pick an approver');
            if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
            setBusy(true);
            setError(null);
            try {
              const g = await send<{ group: { id: string } }>('/api/access/groups', 'POST', { key: keyFromName(name), name: name.trim(), ownerIds: [approver[0]], reason: reason.trim() });
              for (const userId of members) await send(`/api/access/groups/${g.group.id}/members`, 'POST', { userId, reason: reason.trim() });
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

function PersonDetail({ userId }: { userId: string }) {
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
  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-eyebrow uppercase text-muted-foreground">Person</p>
        <h2 className="flex items-center gap-2 text-title-section">
          <User className="h-4 w-4" aria-hidden="true" />
          {personName(info.person)}
        </h2>
        <p className="text-caption text-muted-foreground">
          {info.person.email} · app role {info.person.roles.join(', ')}
        </p>
      </header>
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
            <span key={g.id} className={cn(s.chip, s.chipBrand)}>
              {g.name}
              {g.expiresAt ? ` · until ${new Date(g.expiresAt).toLocaleDateString()}` : ''}
            </span>
          ))}
          {info.groups.length === 0 && info.builtins.length === 0 ? <span className="text-caption text-muted-foreground">None</span> : null}
        </div>
      </section>
      <section className={s.card} aria-label="Can use">
        <div className={s.cardHead}>
          <h3 className={s.cardTitle}>Can use ({plural(info.rules.filter((r) => r.access !== 'block').length, 'rule')})</h3>
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-1')}>
          {info.rules.length === 0 ? <p className="text-caption text-muted-foreground">No data yet.</p> : null}
          {info.rules.map((r, i) => (
            <p key={i} className="text-caption">
              <span className={cn('font-medium', r.access === 'block' && 'text-[var(--bad)]')}>{ACCESS_LABEL[r.access]}</span> <code>{r.path}</code>{' '}
              <span className="text-muted-foreground">· {r.through}</span>
            </p>
          ))}
        </div>
      </section>
      <section className={s.card} aria-label="Protected data">
        <div className={s.cardHead}>
          <h3 className={s.cardTitle}>Protected data</h3>
        </div>
        <div className={cn(s.cardBody, 'flex flex-col gap-1')}>
          {held.map((p) => (
            <p key={p.id} className="text-caption">
              <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />
              <span className="font-medium">{p.name}</span> · {LEVEL_LABEL[p.level]} <span className="text-muted-foreground">· {p.through.join(', ')}</span>
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
