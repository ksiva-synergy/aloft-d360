'use client';

import { useCallback, useEffect, useState, type ElementType } from 'react';
import { Database, Lock, RefreshCw, ScrollText, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSearchParams } from '@/lib/navigation';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, runAsync, type AccessStatus, type Person } from '@/components/access/console/api';
import { RequestsView } from '@/components/access/console/RequestsView';
import { ColumnAccessView } from '@/components/access/console/ColumnAccessView';
import { DataView } from '@/components/access/console/DataView';
import { PeopleGroupsView } from '@/components/access/console/PeopleGroupsView';
import s from '@/components/access/console/console.module.css';
import { ConsoleReadOnlyContext } from '@/components/access/console/readOnly';
import { useSectionLevel } from '@/lib/sections/useSectionLevels';

/** Simplified model (docs/access/simplified-access-model.md §4): four tabs. */
type Tab = 'data' | 'protections' | 'people' | 'log';

const TABS: { id: Tab; label: string; icon: ElementType }[] = [
  { id: 'data', label: 'Data', icon: Database },
  { id: 'protections', label: 'Protections', icon: Lock },
  { id: 'people', label: 'People & groups', icon: Users },
  { id: 'log', label: 'Requests & log', icon: ScrollText },
];

/** Old links (?tab=map, labels, columns, setup) land on the tab that replaced them. */
const TAB_ALIASES: Record<string, Tab> = {
  data: 'data',
  map: 'data',
  setup: 'data',
  protections: 'protections',
  labels: 'protections',
  columns: 'protections',
  people: 'people',
  log: 'log',
};

/** Small status badge next to the title. The full explanation is in the hover text and the Setup guide. */
function ModeBadge({ status }: { status: AccessStatus }) {
  const { accessMode, legacyOpen } = status;
  const color = accessMode === 'enforce' ? 'var(--ok)' : accessMode === 'observe' ? 'var(--brand-b-ink)' : 'var(--warn)';
  const label = accessMode === 'off' ? 'Not enforced' : accessMode === 'observe' ? 'Observe mode' : 'Enforced';
  let detail: string;
  if (accessMode === 'off') detail = 'Settings are saved but nothing is checked or logged yet.';
  else if (accessMode === 'observe') detail = 'Decisions are logged; nothing is blocked.';
  else detail = `Enforcing on ${status.enforcedSurfaces.join(', ') || 'no surfaces'}.`;
  if (legacyOpen && accessMode !== 'off') detail += ' No access rules exist yet, so unprotected data is still open.';
  return (
    <span
      role="status"
      title={detail}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--estate-border)] px-2.5 py-0.5 text-caption font-medium"
      style={{ color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
      <span className="sr-only">. {detail}</span>
    </span>
  );
}

export default function DataAccessPage() {
  // View (not Manage) on Govern → Data access: every tab is read-only. The APIs refuse changes either way.
  const readOnly = useSectionLevel('govern.data-access') !== 'manage';
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const initialUser = searchParams.get('user');
  const [tab, setTab] = useState<Tab>(initialUser ? 'people' : (initialTab && TAB_ALIASES[initialTab]) || 'data');
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Reload shared data. Sets state only after the request returns. */
  const refresh = useCallback(async () => {
    try {
      const [st, u] = await Promise.all([
        accessFetch<AccessStatus>('/api/access/status'),
        accessFetch<{ users: Person[] }>('/api/access/users'),
      ]);
      setStatus(st);
      setPeople(u.users);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load data access');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runAsync(refresh);
  }, [refresh]);

  const onRefreshClick = () => {
    setLoading(true);
    void refresh();
  };

  const tabCount = (id: Tab): number | null => {
    if (!status) return null;
    if (id === 'log') return status.counts.denies7d || null;
    return null;
  };

  return (
    <div className={cn(userStyles.surface, userStyles.page)}>
      <div className={userStyles.content}>
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="mb-1 flex items-center gap-2 text-eyebrow uppercase text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-a)]" />
              Workspace administration
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-title-section">Data access</h1>
              {status ? <ModeBadge status={status} /> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onRefreshClick}
            disabled={loading}
            className={cn(userStyles.iconButton, 'disabled:opacity-40')}
            title="Refresh"
            aria-label="Refresh data access"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-size-ui text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
          >
            <span>{error}</span>
            <button type="button" onClick={onRefreshClick} className="ml-auto shrink-0 underline">
              Retry
            </button>
          </div>
        ) : null}

        <ConsoleReadOnlyContext.Provider value={readOnly}>
        <section className={cn(userStyles.directory, 'mt-5')}>
          <nav className={s.nav} role="tablist" aria-label="Data access sections">
            {TABS.map((t) => {
              const count = tabCount(t.id);
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={cn(s.navBtn, tab === t.id && s.navBtnActive)}
                  onClick={() => setTab(t.id)}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t.label}
                  {count !== null ? <span className={s.navCount}>{count}</span> : null}
                </button>
              );
            })}
          </nav>

          {!status ? (
            <p className="p-6 text-size-ui text-muted-foreground">{loading ? 'Loading…' : 'Nothing to show.'}</p>
          ) : tab === 'data' ? (
            <DataView people={people} meId={status.me.userId} isPlatformAdmin={status.me.platformAdmin} />
          ) : tab === 'people' ? (
            <PeopleGroupsView
              people={people}
              meId={status.me.userId}
              isPlatformAdmin={status.me.platformAdmin}
              focusUserId={initialUser}
              onChanged={refresh}
            />
          ) : tab === 'protections' ? (
            <ColumnAccessView
              people={people}
              meId={status.me.userId}
              isPlatformAdmin={status.me.platformAdmin}
              onChanged={refresh}
            />
          ) : (
            <RequestsView people={people} meId={status.me.userId} isPlatformAdmin={status.me.platformAdmin} />
          )}
        </section>
        </ConsoleReadOnlyContext.Provider>
      </div>
    </div>
  );
}
