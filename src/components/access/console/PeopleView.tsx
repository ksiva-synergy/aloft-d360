'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, Lock, Plus, Search, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import userStyles from '@/components/users/users.module.css';
import { SENSITIVITY_LABEL, personName, send, type Department, type Person, type RoleInfo, type Sensitivity } from './api';
import { PersonAccessEditor } from './PersonAccessEditor';
import { ConsoleSelect, Segmented, type SegOption } from './parts';
import s from './console.module.css';
import { useConsoleReadOnly } from './readOnly';

type Filter = 'all' | 'none' | 'cleared';

const RANK: Record<Sensitivity, number> = { internal: 0, confidential: 1, restricted: 2 };

/** Raising clearance is platform-admin only; lowering is open to every data access admin. */
function clearanceOptions(current: Sensitivity, canRaise: boolean): SegOption<Sensitivity>[] {
  const base: SegOption<Sensitivity>[] = [
    { value: 'internal', label: 'Internal', title: 'Default: unlabelled data only' },
    { value: 'confidential', label: 'Confidential', tone: 'warn', title: 'Also Confidential tables their grants cover' },
    { value: 'restricted', label: 'Restricted', tone: 'danger', title: 'Also Confidential and Restricted tables their grants cover' },
  ];
  return base.map((o) =>
    !canRaise && RANK[o.value] > RANK[current]
      ? { ...o, disabled: true, title: 'Only a platform admin can raise clearance' }
      : o,
  );
}

export function PeopleView({
  people,
  departments,
  roles,
  meId,
  isPlatformAdmin,
  focusId,
  onChanged,
}: {
  people: Person[];
  departments: Department[];
  roles: RoleInfo[];
  meId: string | null;
  isPlatformAdmin: boolean;
  /** Open this person's details first (deep link from Users). */
  focusId: string | null;
  onChanged: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [deptFilter, setDeptFilter] = useState<string>('');
  const [openId, setOpenId] = useState<string | null>(focusId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const roleLabel = useMemo(() => new Map(roles.map((r) => [r.name, r.label])), [roles]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = people.filter((p) => {
      if (filter === 'none' && p.departmentIds.length > 0) return false;
      if (filter === 'cleared' && p.clearance === 'internal') return false;
      if (deptFilter && !p.departmentIds.includes(deptFilter)) return false;
      if (!q) return true;
      return `${p.name ?? ''} ${p.email}`.toLowerCase().includes(q);
    });
    if (focusId) list.sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId));
    return list;
  }, [people, query, filter, deptFilter, focusId]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Change failed');
    } finally {
      setBusy(null);
    }
  }

  const setMember = (p: Person, departmentId: string, on: boolean) =>
    run(`${p.id}:${departmentId}`, () =>
      send(`/api/access/departments/${departmentId}/members`, on ? 'POST' : 'DELETE', { userId: p.id }),
    );

  const setClearance = (p: Person, level: Sensitivity) =>
    run(`${p.id}:clearance`, () =>
      level === 'internal'
        ? send('/api/access/clearances', 'DELETE', { userId: p.id })
        : send('/api/access/clearances', 'POST', { userId: p.id, level }),
    );

  const noDept = people.filter((p) => p.departmentIds.length === 0).length;
  const readOnly = useConsoleReadOnly();

  return (
    <div className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className={cn(userStyles.input, '!pl-8')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
          />
        </div>
        <Segmented<Filter>
          ariaLabel="Filter people"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `Everyone ${people.length}` },
            { value: 'none', label: `No department ${noDept}` },
            { value: 'cleared', label: 'Has clearance' },
          ]}
        />
        <ConsoleSelect
          className="min-w-[11rem]"
          value={deptFilter || '__all__'}
          ariaLabel="Show one department"
          onChange={(v) => setDeptFilter(v === '__all__' ? '' : v)}
          options={[
            { value: '__all__', label: 'All departments' },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </div>

      <p className="mb-3 text-caption text-muted-foreground">
        A person can use the data mapped to their app role and to each of their departments. Clearance only matters for
        Confidential or Restricted tables{isPlatformAdmin ? '' : ', and only a platform admin can raise it'}. Platform admins
        see all data, including protected columns.
      </p>

      {error ? (
        <p className={cn(s.errorText, 'mb-3')} role="alert">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--estate-border)]">
        <table className={s.peopleTable}>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">App role</th>
              <th scope="col">Departments</th>
              <th scope="col">Clearance</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="!py-10 text-center text-muted-foreground">
                  Nobody matches.
                </td>
              </tr>
            ) : (
              shown.map((p) => {
                const isSelf = p.id === meId;
                const open = openId === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td>
                        <div className="font-medium">{personName(p)}</div>
                        <div className="text-caption text-muted-foreground">
                          {p.email}
                          {isSelf ? ' · you' : ''}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {p.platformAdmin ? (
                          <span className={cn(s.chip, s.chipOk)} title="Sees all data, including protected columns, and can open protected data to others.">
                            <ShieldCheck className="h-3 w-3" /> {roleLabel.get(p.role) ?? p.role}
                          </span>
                        ) : (
                          <span className={s.chip}>{roleLabel.get(p.role) ?? p.role}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {p.departmentIds.map((id) => (
                            <span key={id} className={cn(s.chip, s.chipBrand)}>
                              {deptName.get(id) ?? 'Archived'}
                              {readOnly ? null : (
                              <button
                                type="button"
                                className={s.chipRemove}
                                disabled={busy !== null}
                                onClick={() => void setMember(p, id, false)}
                                aria-label={`Remove ${personName(p)} from ${deptName.get(id) ?? 'department'}`}
                              >
                                ×
                              </button>
                              )}
                            </span>
                          ))}
                          {readOnly ? (
                            p.departmentIds.length === 0 ? <span className="text-caption text-muted-foreground">None</span> : null
                          ) : (
                            <DepartmentPicker
                              person={p}
                              departments={departments}
                              disabled={busy !== null}
                              onToggle={(id, on) => void setMember(p, id, on)}
                            />
                          )}
                        </div>
                      </td>
                      <td>
                          <>
                            <Segmented<Sensitivity>
                              ariaLabel={`Clearance for ${personName(p)}`}
                              options={clearanceOptions(p.clearance, isPlatformAdmin)}
                              value={p.clearance}
                              disabled={readOnly || isSelf || busy !== null}
                              onChange={(v) => void setClearance(p, v)}
                            />
                            {readOnly ? null : isSelf ? (
                              <div className="mt-1 text-caption text-muted-foreground">You cannot change your own.</div>
                            ) : !isPlatformAdmin && p.clearance !== 'restricted' ? (
                              <div className="mt-1 text-caption text-muted-foreground">
                                <Lock className="inline h-3 w-3" /> Raise: platform admin
                              </div>
                            ) : null}
                          </>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className={cn(s.linkBtn, 'inline-flex items-center gap-1 whitespace-nowrap')}
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? null : p.id)}
                        >
                          {open ? 'Hide access' : 'View access'}
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr className={s.expandedRow}>
                        <td colSpan={5}>
                          <PersonAccessEditor
                            personId={p.id}
                            people={people}
                            departments={departments}
                            roles={roles}
                            meId={meId}
                            isPlatformAdmin={isPlatformAdmin}
                            onChanged={onChanged}
                            showHeader={false}
                            showPolicyCards={false}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-caption text-muted-foreground">
        {SENSITIVITY_LABEL.internal} is the default clearance. Changes save straight away.
      </p>
    </div>
  );
}

function DepartmentPicker({
  person,
  departments,
  disabled,
  onToggle,
}: {
  person: Person;
  departments: Department[];
  disabled: boolean;
  onToggle: (departmentId: string, on: boolean) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={s.tagBtn}
          disabled={disabled || departments.length === 0}
          aria-label={`Choose departments for ${personName(person)}`}
          title={departments.length === 0 ? 'Create a department on the Data map first' : undefined}
        >
          <Plus className="h-3 w-3" /> Department
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(userStyles.surface, '!w-72 z-[100]')}>
        <p className="mb-2 text-size-ui font-semibold">Departments for {personName(person)}</p>
        <div className={s.choiceList}>
          {departments.map((d) => {
            const on = person.departmentIds.includes(d.id);
            return (
              <label key={d.id} className={cn(s.choice, on && s.choiceOn)}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={(e) => onToggle(d.id, e.target.checked)}
                />
                <span className={s.choiceTitle}>{d.name}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
