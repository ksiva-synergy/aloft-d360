'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Search, User, UsersRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { keyFromName, personName, send, type AccessGroup, type Person, type TagLevel } from './api';
import { Segmented } from './parts';
import s from './console.module.css';

/* ─────────────────────────────────────────────────────────────────────────────
 * "Give access to …" — the one form used everywhere someone is allowed to see protected data.
 *
 *   Give access to:  (•) Specific people   ( ) A group
 *   People:          [search name or email]  → chips
 *   — or —
 *   Group:           [Payroll team (8) ▾ | + New group]
 *                    new: name, approver, people
 *   They see:        Exact values | Totals only
 *   For:             30 days | 90 days | No end date
 *
 * Specific people → one access row per person. A group → the group gets access; people added to a
 * new group get the chosen end date on their membership.
 * ──────────────────────────────────────────────────────────────────────────── */

export type Duration = '30' | '90' | 'none';
export const DURATIONS: { value: Duration; label: string }[] = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'none', label: 'No end date' },
];
export const expiryFor = (d: Duration) => (d === 'none' ? null : new Date(Date.now() + Number(d) * 86_400_000).toISOString());

export const NEW_GROUP = '__new_group__';

const LEVELS: { value: TagLevel; label: string; title: string }[] = [
  { value: 'full', label: 'Exact values', title: 'Sees the real values' },
  { value: 'aggregate', label: 'Totals only', title: 'Averages and totals over 5 or more people; no individual values' },
];

export type AccessChoice = {
  mode: 'people' | 'group';
  people: string[];
  groupId: string;
  groupName: string;
  approverId: string;
  members: string[];
  level: TagLevel;
  duration: Duration;
};

export function emptyChoice(groups: AccessGroup[]): AccessChoice {
  return {
    mode: 'people',
    people: [],
    groupId: groups[0]?.id ?? NEW_GROUP,
    groupName: '',
    approverId: '',
    members: [],
    level: 'full',
    duration: '30',
  };
}

/** A plain-language problem with the choice, or null when it can be saved. */
export function choiceProblem(c: AccessChoice): string | null {
  if (c.mode === 'people') return c.people.length ? null : 'Pick at least one person';
  if (c.groupId !== NEW_GROUP) return c.groupId ? null : 'Pick a group';
  if (c.groupName.trim().length < 2) return 'Name the new group, e.g. Payroll team';
  if (!c.approverId) return 'Pick who approves requests to join the group';
  return null;
}

/** Save the choice for one protected kind of data (tag). Returns a short summary for the notice. */
export async function applyAccess(tagId: string, c: AccessChoice, reason: string, people: Person[]): Promise<string> {
  const expiresAt = expiryFor(c.duration);
  if (c.mode === 'people') {
    for (const userId of c.people) {
      await send('/api/access/tag-grants', 'POST', { tagId, principalType: 'user', principalId: userId, level: c.level, expiresAt, reason });
    }
    const names = c.people.map((id) => personName(people.find((p) => p.id === id), 'someone'));
    return names.length <= 2 ? names.join(' and ') : `${names.length} people`;
  }

  let groupId = c.groupId;
  let label = '';
  if (groupId === NEW_GROUP) {
    const g = await send<{ group: { id: string; name: string } }>('/api/access/groups', 'POST', {
      key: keyFromName(c.groupName),
      name: c.groupName.trim(),
      ownerIds: [c.approverId],
      reason,
    });
    groupId = g.group.id;
    label = c.groupName.trim();
    for (const userId of c.members) {
      await send(`/api/access/groups/${groupId}/members`, 'POST', { userId, expiresAt, reason });
    }
  }
  await send('/api/access/tag-grants', 'POST', { tagId, principalType: 'group', principalId: groupId, level: c.level, reason });
  return label || 'the group';
}

/* ── People picker: search inline, click to add, chips to remove ─────────── */

export function PeoplePicker({
  people,
  value,
  onChange,
  exclude = [],
  single,
  label,
  placeholder = 'Search name or email',
}: {
  people: Person[];
  value: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  single?: boolean;
  label: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const hidden = useMemo(() => new Set([...exclude, ...value]), [exclude, value]);
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return people
      .filter((p) => !hidden.has(p.id) && `${p.name ?? ''} ${p.email}`.toLowerCase().includes(term))
      .slice(0, 6);
  }, [q, people, hidden]);

  const picked = value.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  const showInput = !(single && picked.length === 1);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium">{label}</span>
      {picked.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label}: chosen`}>
          {picked.map((p) => (
            <li key={p.id} className={cn(s.chip, s.chipBrand, 'h-7 max-w-full')}>
              <span className="truncate">{personName(p)}</span>
              <button
                type="button"
                className="opacity-70 hover:opacity-100"
                aria-label={`Remove ${personName(p)}`}
                onClick={() => onChange(value.filter((id) => id !== p.id))}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showInput ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className={cn(userStyles.input, '!pl-9')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
          />
        </div>
      ) : null}
      {matches.length ? (
        <ul className="overflow-hidden rounded-[8px] border border-[var(--estate-border)] bg-[var(--estate-surface)]" role="listbox" aria-label={`${label}: matches`}>
          {matches.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-size-ui hover:bg-[var(--surface-2)]"
                onClick={() => {
                  onChange(single ? [p.id] : [...value, p.id]);
                  setQ('');
                }}
              >
                <span className="truncate font-medium">{p.name?.trim() || p.email}</span>
                {p.name ? <span className="truncate text-caption text-muted-foreground">{p.email}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim() ? (
        <p className="text-caption text-muted-foreground">No one matches “{q.trim()}”.</p>
      ) : null}
    </div>
  );
}

/* ── The fields ───────────────────────────────────────────────────────────── */

function ChoiceCard({ on, icon, title, hint, onPick }: { on: boolean; icon: ReactNode; title: string; hint: string; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        'flex flex-1 items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left',
        on ? 'border-[var(--brand-a)] bg-[var(--brand-a-soft)]' : 'border-[var(--estate-border)] hover:bg-[var(--surface-2)]',
      )}
    >
      <span className="mt-0.5 text-[var(--brand-a-ink)]">{icon}</span>
      <span>
        <span className="block text-size-ui font-semibold">{title}</span>
        <span className="block text-caption text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

export function AccessFields({
  value,
  onChange,
  groups,
  people,
  meId,
  excludePeople = [],
}: {
  value: AccessChoice;
  onChange: (next: AccessChoice) => void;
  groups: AccessGroup[];
  people: Person[];
  meId: string;
  /** People who already have access (hidden from the picker). */
  excludePeople?: string[];
}) {
  const set = (patch: Partial<AccessChoice>) => onChange({ ...value, ...patch });
  const members = (g: AccessGroup) => g.members.filter((m) => !m.expired).length;

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Give access to" className="flex flex-col gap-2 sm:flex-row">
        <ChoiceCard
          on={value.mode === 'people'}
          icon={<User className="h-4 w-4" aria-hidden="true" />}
          title="Specific people"
          hint="Pick them by name"
          onPick={() => set({ mode: 'people' })}
        />
        <ChoiceCard
          on={value.mode === 'group'}
          icon={<UsersRound className="h-4 w-4" aria-hidden="true" />}
          title="A group"
          hint="e.g. Payroll team, with an approver"
          onPick={() => set({ mode: 'group' })}
        />
      </div>

      {value.mode === 'people' ? (
        <PeoplePicker
          label="People"
          people={people}
          value={value.people}
          onChange={(ids) => set({ people: ids })}
          exclude={[meId, ...excludePeople]}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium">Group</span>
            <select className={userStyles.input} value={value.groupId} onChange={(e) => set({ groupId: e.target.value })} aria-label="Group">
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({members(g)} {members(g) === 1 ? 'person' : 'people'})
                </option>
              ))}
              <option value={NEW_GROUP}>+ Create a new group</option>
            </select>
          </label>
          {value.groupId === NEW_GROUP ? (
            <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-[var(--estate-border)] p-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium">Group name</span>
                <Input
                  className={userStyles.input}
                  value={value.groupName}
                  onChange={(e) => set({ groupName: e.target.value })}
                  placeholder="e.g. Payroll team"
                  aria-label="Group name"
                />
              </label>
              <PeoplePicker
                label="Approver"
                single
                people={people}
                value={value.approverId ? [value.approverId] : []}
                onChange={(ids) => set({ approverId: ids[0] ?? '' })}
                placeholder="Who approves requests to join"
              />
              <PeoplePicker
                label="People in the group"
                people={people}
                value={value.members}
                onChange={(ids) => set({ members: ids })}
                exclude={[meId]}
                placeholder="Add people now (optional)"
              />
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-caption text-muted-foreground">They see</span>
        <Segmented<TagLevel> ariaLabel="What they see" options={LEVELS} value={value.level} onChange={(level) => set({ level })} />
      </div>
      {value.mode === 'people' || value.groupId === NEW_GROUP ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-caption text-muted-foreground">For</span>
          <Segmented<Duration> ariaLabel="How long" options={DURATIONS} value={value.duration} onChange={(duration) => set({ duration })} />
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">You can't give access to yourself; another platform admin has to.</p>
    </div>
  );
}
