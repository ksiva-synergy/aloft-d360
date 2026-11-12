'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, keyFromName, runAsync, send, type AccessGroup } from './api';
import type { Department } from './DepartmentsView';
import { ConfirmButton, ConsoleSelect, Segmented } from './parts';
import s from './console.module.css';

/**
 * On a group: which departments' data its people may use (Use, or Use + export). A person in several groups
 * gets all of them. Which data belongs to a department is set on the Departments tab.
 */

type LinkLevel = 'use' | 'export';
const LEVEL_OPTIONS = [
  { value: 'use' as const, label: 'Use', title: 'People can query this data' },
  { value: 'export' as const, label: 'Use + export', title: 'People can query and export this data' },
];
const NEW_DEPARTMENT = '__new__';

export function GroupDepartments({ group, readOnly, onChanged }: { group: AccessGroup; readOnly: boolean; onChanged: () => Promise<void> | void }) {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [pick, setPick] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await accessFetch<{ departments: Department[] }>('/api/access/data-departments');
    setDepartments(r.departments);
  }, []);
  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load departments')));
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const link = (departmentId: string, level: LinkLevel) =>
    send('/api/access/department-groups', 'PUT', { departmentId, groupId: group.id, allowExport: level === 'export' });

  const mine = (departments ?? []).flatMap((d) => {
    const l = d.groups.find((x) => x.groupId === group.id);
    return l ? [{ department: d, allowExport: l.allowExport }] : [];
  });
  const available = (departments ?? []).filter((d) => !d.groups.some((x) => x.groupId === group.id));
  const value = pick || available[0]?.id || NEW_DEPARTMENT;
  const creating = value === NEW_DEPARTMENT;

  return (
    <section className={s.card} aria-label="Departments this group can use">
      <div className={s.cardHead}>
        <div>
          <h3 className={s.cardTitle}>Departments it can use</h3>
          <p className={s.cardHint}>Everyone in this group can use all the data that belongs to these departments. Set what belongs to a department on the Departments tab.</p>
        </div>
      </div>
      <div className={cn(s.cardBody, 'flex flex-col gap-2')}>
        {departments === null ? (
          <p className="text-caption text-muted-foreground">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="text-caption text-muted-foreground">None yet, so this group has no department data.</p>
        ) : (
          <ul className="flex flex-col">
            {mine.map(({ department, allowExport }) => (
              <li key={department.id} className={s.tagEditorRow}>
                <span className="flex min-w-0 items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-medium">{department.name}</span>
                  <span className="text-caption text-muted-foreground">
                    {department.paths.length} item{department.paths.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Segmented<LinkLevel>
                    ariaLabel={`${group.name} access to ${department.name} data`}
                    options={LEVEL_OPTIONS}
                    value={allowExport ? 'export' : 'use'}
                    disabled={busy || readOnly}
                    onChange={(v) => void run(() => link(department.id, v))}
                  />
                  {readOnly ? null : (
                    <ConfirmButton
                      label="Remove"
                      ariaLabel={`Remove ${department.name}`}
                      disabled={busy}
                      onConfirm={() => run(() => send('/api/access/department-groups', 'DELETE', { departmentId: department.id, groupId: group.id }))}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {readOnly ? null : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <ConsoleSelect
                className="min-w-[12rem]"
                value={value}
                ariaLabel="Department to add"
                onChange={setPick}
                options={[...available.map((d) => ({ value: d.id, label: d.name })), { value: NEW_DEPARTMENT, label: '+ Create a new department' }]}
              />
              {creating ? (
                <Input className={cn(userStyles.input, 'w-48')} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Department name, e.g. Marine" aria-label="Department name" />
              ) : null}
              <button
                type="button"
                className={cn(s.protectCompactBtn, userStyles.secondaryButton)}
                disabled={busy || (creating && newName.trim().length < 2)}
                onClick={() =>
                  void run(async () => {
                    let departmentId = value;
                    if (creating) {
                      const r = await send<{ department: { id: string } }>('/api/access/data-departments', 'POST', { key: keyFromName(newName), name: newName.trim() });
                      departmentId = r.department.id;
                      setNewName('');
                    }
                    setPick('');
                    await link(departmentId, 'use');
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {creating ? 'Create and add department' : 'Add department'}
              </button>
            </div>
          </div>
        )}
        {error ? (
          <p className={s.errorText} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
