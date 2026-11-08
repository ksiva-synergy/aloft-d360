'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { KeyRound, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { accessFetch, runAsync } from '@/components/access/console/api';
import styles from '@/components/users/users.module.css';

type UserDataAccessSectionProps = {
  userId: string;
  userDisplayName: string;
  canManage: boolean;
};

type PersonInfo = {
  groups: { id: string; name: string; expiresAt: string | null }[];
  builtins: { id: string; name: string }[];
  rules: { path: string; access: 'use' | 'export' | 'block'; through: string }[];
  protections: { id: string; name: string; level: 'full' | 'aggregate' | 'none' }[];
};

const ACCESS_LABEL = { use: 'Use', export: 'Use + export', block: 'Block' } as const;

/**
 * Users drawer: a read-only summary of this person's data access (simplified model). Changes are
 * made in Govern → Data access (Data, Protections, People & groups).
 */
export function UserDataAccessSection({ userId, canManage }: UserDataAccessSectionProps) {
  const [info, setInfo] = useState<PersonInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await accessFetch<PersonInfo>(`/api/access/person?userId=${encodeURIComponent(userId)}`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load data access');
    }
  }, [userId]);

  useEffect(() => {
    if (canManage) runAsync(load);
  }, [canManage, load]);

  if (!canManage) return null;

  const held = info?.protections.filter((p) => p.level !== 'none') ?? [];

  return (
    <div className={styles.detailSection}>
      <div className="mb-2 flex items-center gap-2 text-title-card">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        Warehouse data access
      </div>
      {loadError ? (
        <p className="text-size-ui text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : info === null ? (
        <p className="text-caption text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2 text-caption">
          <p>
            <span className="text-muted-foreground">Groups: </span>
            {[...info.builtins.map((b) => b.name), ...info.groups.map((g) => g.name)].join(', ') || 'none'}
          </p>
          <p className="text-muted-foreground">Can use:</p>
          {info.rules.length === 0 ? (
            <p>No data yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {info.rules.slice(0, 8).map((r, i) => (
                <li key={i}>
                  {ACCESS_LABEL[r.access]} <code>{r.path}</code> <span className="text-muted-foreground">· {r.through}</span>
                </li>
              ))}
              {info.rules.length > 8 ? <li className="text-muted-foreground">+{info.rules.length - 8} more</li> : null}
            </ul>
          )}
          <p>
            <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />
            <span className="text-muted-foreground">Protected data: </span>
            {held.length ? held.map((p) => `${p.name}${p.level === 'aggregate' ? ' (totals only)' : ''}`).join(', ') : 'none'}
          </p>
        </div>
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
