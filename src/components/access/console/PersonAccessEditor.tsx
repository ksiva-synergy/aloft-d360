'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Lock, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import userStyles from '@/components/users/users.module.css';
import {
  LEVEL_HINT,
  LEVEL_LABEL,
  SENSITIVITY_LABEL,
  accessFetch,
  personName,
  reasonText,
  runAsync,
  send,
  type Department,
  type Grant,
  type GrantRef,
  type Level,
  type Person,
  type RoleInfo,
  type Sensitivity,
  type TreeNode,
  type UserPathExplanation,
} from './api';
import { EstateTree } from './EstateTree';
import { Card, Mono, Segmented, type SegOption } from './parts';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

const RANK: Record<Sensitivity, number> = { internal: 0, confidential: 1, restricted: 2 };
const LOCK_TITLE = 'Labelled data: only a platform admin can open it';

const CLEARANCE_CHOICES: { value: Sensitivity; title: string; hint: string }[] = [
  {
    value: 'internal',
    title: 'Internal',
    hint: 'Default. Can use unlabelled data that a grant covers. Confidential and Restricted tables stay hidden.',
  },
  { value: 'confidential', title: 'Confidential', hint: 'Can also use Confidential tables, when a grant already covers them.' },
  {
    value: 'restricted',
    title: 'Restricted',
    hint: 'Can use Confidential and Restricted tables, when a grant already covers them.',
  },
];

type Choice = 'none' | Level | 'deny';

function choices(locked: boolean): SegOption<Choice>[] {
  return [
    { value: 'none', label: 'None', title: 'No grant of their own here' },
    { value: 'discover', label: 'Discover', title: locked ? LOCK_TITLE : LEVEL_HINT.discover, disabled: locked },
    { value: 'query', label: 'Query', title: locked ? LOCK_TITLE : LEVEL_HINT.query, disabled: locked },
    { value: 'export', label: 'Export', title: locked ? LOCK_TITLE : LEVEL_HINT.export, disabled: locked },
    { value: 'deny', label: 'Block', tone: 'danger', title: 'Deny this path even if a role or department grants it' },
  ];
}

type Names = { department: Map<string, string>; role: Map<string, string> };

export function PersonAccessEditor({
  personId,
  people,
  departments,
  roles,
  meId,
  isPlatformAdmin,
  onChanged,
  showHeader = true,
  showPolicyCards = true,
}: {
  personId: string;
  people: Person[];
  departments: Department[];
  roles: RoleInfo[];
  meId: string | null;
  /** The signed-in admin is a platform admin (may open labelled data). */
  isPlatformAdmin: boolean;
  onChanged: () => Promise<void> | void;
  /** Hide the name and summary when the host already shows them (Users drawer). */
  showHeader?: boolean;
  /** Show the Departments and Clearance cards (off when the host edits them inline). */
  showPolicyCards?: boolean;
}) {
  const person = people.find((p) => p.id === personId);
  const isSelf = meId === personId;
  const readOnly = useConsoleReadOnly();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const [whyOpen, setWhyOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Map<string, TreeNode>>(new Map());
  const [bulkLevel, setBulkLevel] = useState<Choice>('query');

  const loadGrants = useCallback(async () => {
    try {
      const data = await accessFetch<{ grants: Grant[] }>('/api/access/grants');
      setGrants(data.grants.filter((g) => g.principalType === 'user' && g.principalId === personId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load grants');
    }
  }, [personId]);

  // Remount (key) to switch person; this only loads.
  useEffect(() => {
    runAsync(loadGrants);
  }, [loadGrants]);

  const names: Names = useMemo(
    () => ({
      department: new Map(departments.map((d) => [d.id, d.name])),
      role: new Map(roles.map((r) => [r.name, r.label])),
    }),
    [departments, roles],
  );

  if (!person) return <p className="text-size-ui text-muted-foreground">Person not found.</p>;

  const name = personName(person);
  const memberOf = departments.filter((d) => person.departmentIds.includes(d.id));
  const roleLabel = names.role.get(person.role) ?? person.role;
  const lockedFor = (node: TreeNode) => !isPlatformAdmin && node.label.label !== 'internal';
  const canEdit = !isSelf && !readOnly;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([onChanged(), loadGrants()]);
      setTreeKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Change failed');
    } finally {
      setBusy(false);
    }
  }

  const toggleDepartment = (deptId: string, on: boolean) =>
    run(() => send(`/api/access/departments/${deptId}/members`, on ? 'POST' : 'DELETE', { userId: personId }));

  const setClearance = (level: Sensitivity) =>
    run(() =>
      level === 'internal'
        ? send('/api/access/clearances', 'DELETE', { userId: personId })
        : send('/api/access/clearances', 'POST', { userId: personId, level }),
    );

  const putDirect = (path: string, level: Choice) =>
    send('/api/access/grants/level', 'PUT', { principalType: 'user', principalId: personId, path, level });

  const setDirect = (path: string, level: Choice) => run(() => putDirect(path, level));

  async function applyBulk() {
    const opening = bulkLevel === 'discover' || bulkLevel === 'query' || bulkLevel === 'export';
    const locked = [...selected.values()].filter((n) => opening && lockedFor(n)).map((n) => n.path);
    if (locked.length) {
      setError(`Only a platform admin can open labelled data: ${locked.join(', ')}. Untick these and try again.`);
      return;
    }
    await run(async () => {
      for (const path of selected.keys()) await putDirect(path, bulkLevel);
    });
    setSelected(new Map());
  }

  return (
    <>
      <div className={s.detailHead} hidden={!showHeader}>
        <div>
          <h2 className="text-title-card">{name}</h2>
          <p className={s.summaryLine}>
            {person.email}
            <br />
            {roleLabel} · {memberOf.length ? `In ${memberOf.map((d) => d.name).join(', ')}` : 'Not in any department'} ·{' '}
            {SENSITIVITY_LABEL[person.clearance]} clearance
          </p>
        </div>
      </div>

      {isSelf ? (
        <p className={cn(userStyles.notice, 'mb-4 text-size-ui text-muted-foreground')}>
          This is you. Nobody can change their own clearance or grants. Ask another admin.
        </p>
      ) : null}

      {error ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}

      <div className={s.cardGrid} hidden={!showPolicyCards}>
        <Card title="Departments" hint={`The person gets everything mapped to these departments, plus everything mapped to the ${roleLabel} app role.`}>
          {departments.length === 0 ? (
            <p className="text-caption text-muted-foreground">No departments exist yet. Create one on the Data map.</p>
          ) : (
            <div className={s.choiceList}>
              {departments.map((d) => {
                const on = person.departmentIds.includes(d.id);
                return (
                  <label key={d.id} className={cn(s.choice, on && s.choiceOn)}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy || !canEdit}
                      onChange={(e) => void toggleDepartment(d.id, e.target.checked)}
                    />
                    <span>
                      <span className={s.choiceTitle}>{d.name}</span>
                      <span className={s.choiceHint}>{d.memberCount ?? 0} people</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Clearance"
          hint={
            isPlatformAdmin
              ? 'Clearance never gives access by itself. It lets the person use labelled data their grants already cover.'
              : 'Only a platform admin can raise clearance. You can lower it.'
          }
        >
          <div className={s.choiceList} role="radiogroup" aria-label={`Clearance for ${name}`}>
            {CLEARANCE_CHOICES.map((c) => {
              const on = person.clearance === c.value;
              const raise = RANK[c.value] > RANK[person.clearance];
              const disabled = !canEdit || busy || (raise && !isPlatformAdmin);
              return (
                <label key={c.value} className={cn(s.choice, on && s.choiceOn, disabled && !on && s.choiceDisabled)}>
                  <input
                    type="radio"
                    name={`clearance-${personId}`}
                    checked={on}
                    disabled={disabled}
                    onChange={() => void setClearance(c.value)}
                  />
                  <span>
                    <span className={s.choiceTitle}>
                      {c.title} {raise && !isPlatformAdmin ? <Lock className="inline h-3 w-3" aria-label={LOCK_TITLE} /> : null}
                    </span>
                    <span className={s.choiceHint}>{c.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Card>
      </div>

      {grants && grants.length > 0 ? (
        <Card
          className={showPolicyCards ? 'mt-[14px]' : undefined}
          title={`${name}'s own grants (${grants.length})`}
          hint="Exceptions for this person only, on top of their role and departments."
        >
          <ul className="flex flex-col">
            {grants.map((g) => (
              <li key={g.id} className={s.tagEditorRow}>
                <Mono>{g.path}</Mono>
                <span className="flex items-center gap-2">
                  <span className={cn(s.chip, g.effect === 'deny' ? s.chipBad : s.chipBrand)}>
                    {g.effect === 'deny' ? 'Blocked' : LEVEL_LABEL[g.level]}
                  </span>
                  <button
                    type="button"
                    className={s.linkBtn}
                    disabled={!canEdit || busy}
                    onClick={() => void setDirect(g.path, 'none')}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        className={showPolicyCards || (grants && grants.length > 0) ? 'mt-[14px]' : undefined}
        title={`Data for ${name}`}
        hint={
          canEdit
            ? 'Result is what they can use now, from their role, departments, own grants, and clearance. Use the level picker to give them a catalog, schema, or table of their own, or tick several rows to do it at once.'
            : 'What they can use now, from their role, departments, own grants, and clearance.'
        }
      >
        {selected.size > 0 ? (
          <div className={s.bulkBar} role="region" aria-label="Give selected paths">
            <strong>{selected.size} selected</strong>
            <span className="text-muted-foreground">Give {name}:</span>
            <Segmented<Choice>
              ariaLabel="Level for selected paths"
              options={[...choices(false).filter((o) => o.value !== 'none'), { value: 'none', label: 'Remove' }]}
              value={bulkLevel}
              onChange={setBulkLevel}
            />
            <span className="ml-auto flex gap-2">
              <Button type="button" className={userStyles.primary} disabled={busy} onClick={() => void applyBulk()}>
                {busy ? 'Applying…' : 'Apply'}
              </Button>
              <Button type="button" variant="outline" className={userStyles.secondaryButton} onClick={() => setSelected(new Map())}>
                Clear
              </Button>
            </span>
          </div>
        ) : null}
        <EstateTree
          user={personId}
          rightTitle={canEdit ? 'Result · their own grant' : 'Result'}
          refreshKey={treeKey}
          selected={canEdit ? new Set(selected.keys()) : undefined}
          onToggleSelect={
            canEdit
              ? (node, on) =>
                  setSelected((prev) => {
                    const next = new Map(prev);
                    if (on) next.set(node.path, node);
                    else next.delete(node.path);
                    return next;
                  })
              : undefined
          }
          renderRight={(node) => {
            const locked = lockedFor(node);
            return (
              <>
                <ResultCell node={node} />
                <button
                  type="button"
                  className={s.linkBtn}
                  aria-expanded={whyOpen.has(node.path)}
                  onClick={() =>
                    setWhyOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.path)) next.delete(node.path);
                      else next.add(node.path);
                      return next;
                    })
                  }
                >
                  {whyOpen.has(node.path) ? 'Hide' : 'Why?'}
                </button>
                {canEdit ? (
                  <Segmented<Choice>
                    ariaLabel={`${name}'s own access to ${node.path}`}
                    options={choices(locked)}
                    value={node.userDirect ?? 'none'}
                    disabled={busy}
                    onChange={(v) => void setDirect(node.path, v)}
                  />
                ) : null}
              </>
            );
          }}
          renderBelow={(node) =>
            node.access && whyOpen.has(node.path) ? (
              <WhyPanel a={node.access} person={name} roleLabel={roleLabel} departments={memberOf} names={names} />
            ) : null
          }
        />
      </Card>
    </>
  );
}

function ResultCell({ node }: { node: TreeNode }) {
  const a = node.access;
  if (!a) return null;
  if (a.allowedLevel) {
    return (
      <span className={cn(s.chip, s.chipOk)}>
        <Check className="h-3 w-3" /> {LEVEL_LABEL[a.allowedLevel]}
      </span>
    );
  }
  if (a.reason === 'no_grant' && node.depth < 3 && (node.accessInside ?? 0) > 0) {
    return <span className={cn(s.chip, s.chipBrand)}>Some tables inside</span>;
  }
  return (
    <span className={cn(s.chip, a.reason === 'no_grant' ? '' : s.chipBad)}>{reasonText(a.reason, a.label.label)}</span>
  );
}

function holderName(g: GrantRef, person: string, names: Names): string {
  if (g.principalType === 'department') return `the ${names.department.get(g.principalId) ?? 'archived'} department`;
  if (g.principalType === 'role') return `the ${names.role.get(g.principalId) ?? g.principalId} app role`;
  return `${person} directly`;
}

type StepState = 'ok' | 'fail' | 'skip';

function StepIcon({ state }: { state: StepState }) {
  if (state === 'ok') return <Check className="h-3.5 w-3.5 text-[var(--ok)]" aria-label="passes" />;
  if (state === 'fail') return <X className="h-3.5 w-3.5 text-[var(--bad)]" aria-label="fails" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="not checked" />;
}

export function WhyPanel({
  a,
  person,
  roleLabel,
  departments,
  names,
}: {
  a: UserPathExplanation;
  person: string;
  roleLabel: string;
  departments: Department[];
  names: Names;
}) {
  const steps: { state: StepState; title: string; text: ReactNode }[] = [];

  if (a.legacyOpen) {
    steps.push({
      state: 'ok',
      title: 'Grant',
      text: 'No grants exist in this workspace yet, so every path is open during setup. This ends when the first grant is saved.',
    });
  } else if (a.deny) {
    steps.push({
      state: 'fail',
      title: 'Block',
      text: (
        <>
          Blocked on <Mono>{a.deny.path}</Mono> for {holderName(a.deny, person, names)}. A block wins over every grant.
        </>
      ),
    });
  } else if (a.allow) {
    steps.push({
      state: 'ok',
      title: 'Grant',
      text: (
        <>
          {LEVEL_LABEL[a.allow.level]} on <Mono>{a.allow.path}</Mono>, given to {holderName(a.allow, person, names)}.
        </>
      ),
    });
  } else {
    steps.push({
      state: 'fail',
      title: 'Grant',
      text: `Nothing on this path or above it for ${person}, the ${roleLabel} role, or ${
        departments.length ? departments.map((d) => d.name).join(', ') : 'any department (they are in none)'
      }.`,
    });
  }

  {
    const labelChecked = !a.deny && (a.legacyOpen || a.allow);
    steps.push({
      state: 'ok',
      title: 'Label',
      text:
        a.label.label === 'internal' ? (
          'Internal. No label on this path or above it.'
        ) : (
          <>
            {SENSITIVITY_LABEL[a.label.label]}, set on <Mono>{a.label.from}</Mono>.
          </>
        ),
    });
    const clearanceOk = RANK[a.clearance] >= RANK[a.label.label];
    steps.push({
      state: !labelChecked ? 'skip' : clearanceOk ? 'ok' : 'fail',
      title: 'Clearance',
      text:
        a.label.label === 'internal'
          ? `${person} has ${SENSITIVITY_LABEL[a.clearance]} clearance. None is needed for Internal data.`
          : clearanceOk
            ? `${person} has ${SENSITIVITY_LABEL[a.clearance]} clearance, enough for ${SENSITIVITY_LABEL[a.label.label]}.`
            : `${person} has ${SENSITIVITY_LABEL[a.clearance]} clearance and needs ${SENSITIVITY_LABEL[a.label.label]}. Without it the table is hidden, even its name.`,
    });
  }

  return (
    <div className={s.why}>
      {steps.map((st) => (
        <div key={st.title} className={s.whyStep}>
          <StepIcon state={st.state} />
          <span>{st.title}</span>
          <span>{st.text}</span>
        </div>
      ))}
      <div className={s.whyResult}>
        {a.allowedLevel ? (
          <span className="text-[var(--ok)]">
            Allowed up to {LEVEL_LABEL[a.allowedLevel]} ({LEVEL_HINT[a.allowedLevel].toLowerCase()}).
          </span>
        ) : (
          <span className="text-[var(--bad)]">Not allowed: {reasonText(a.reason, a.label.label).toLowerCase()}.</span>
        )}
      </div>
    </div>
  );
}
