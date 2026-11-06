'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  accessFetch,
  runAsync,
  type AccessStatus,
  type Department,
  type Person,
} from '@/components/access/console/api';
import { PersonAccessEditor } from '@/components/access/console/PersonAccessEditor';
import styles from '@/components/users/users.module.css';

type UserDataAccessSectionProps = {
  userId: string;
  userDisplayName: string;
  canManage: boolean;
};

export function UserDataAccessSection({ userId, canManage }: UserDataAccessSectionProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, u, st] = await Promise.all([
        accessFetch<{ departments: Department[] }>('/api/access/departments'),
        accessFetch<{ users: Person[] }>('/api/access/users'),
        accessFetch<AccessStatus>('/api/access/status'),
      ]);
      setDepartments(d.departments);
      setPeople(u.users);
      setStatus(st);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load data access');
    }
  }, []);

  useEffect(() => {
    if (canManage) runAsync(load);
  }, [canManage, load]);

  if (!canManage) return null;

  return (
    <div className={styles.detailSection}>
      <div className="mb-2 flex items-center gap-2 text-title-card">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        Warehouse data access
      </div>
      <p className="mb-4 text-caption text-muted-foreground">
        Data comes from this person's app role, their departments, and their own grants. Clearance is needed for labelled tables.
      </p>

      {loadError ? (
        <p className="text-size-ui text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : people === null || status === null ? (
        <p className="text-caption text-muted-foreground">Loading…</p>
      ) : (
        <PersonAccessEditor
          personId={userId}
          people={people}
          departments={departments}
          roles={status.roles}
          meId={status.me.userId}
          isPlatformAdmin={status.me.platformAdmin}
          onChanged={load}
          showHeader={false}
        />
      )}

      <Link
        href={`/agent-staging/data-access?user=${encodeURIComponent(userId)}`}
        className={cn(
          styles.profileAction,
          'mt-4 inline-flex items-center justify-center border border-[var(--estate-border)] px-4 text-size-ui text-[var(--brand-a-ink)]',
        )}
      >
        Open in Data access
      </Link>
    </div>
  );
}
