'use client';

import { useCallback, useEffect, useState, type ElementType } from 'react';
import { LayoutList, Network, RefreshCw, ScrollText, Tags, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSearchParams } from '@/lib/navigation';
import userStyles from '@/components/users/users.module.css';
import {
  accessFetch,
  runAsync,
  type AccessStatus,
  type Department,
  type Person,
} from '@/components/access/console/api';
import { OverviewView, type ConsoleTab } from '@/components/access/console/OverviewView';
import { DataMapView } from '@/components/access/console/DataMapView';
import { LabelsView } from '@/components/access/console/LabelsView';
import { PeopleView } from '@/components/access/console/PeopleView';
import { AccessLogView } from '@/components/access/console/AccessLogView';
import s from '@/components/access/console/console.module.css';
import { ConsoleReadOnlyContext } from '@/components/access/console/readOnly';
import { useSectionLevel } from '@/lib/sections/useSectionLevels';

const TABS: { id: ConsoleTab; label: string; icon: ElementType }[] = [
  { id: 'map', label: 'Data map', icon: Network },
  { id: 'people', label: 'People', icon: Users },
  { id: 'labels', label: 'Labels', icon: Tags },
  { id: 'log', label: 'Access log', icon: ScrollText },
  { id: 'setup', label: 'Setup guide', icon: LayoutList },
];

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

function ModeBanner({ status }: { status: AccessStatus }) {
  const { accessMode, legacyOpen } = status;
  const tone = accessMode === 'enforce' ? s.modeEnforce : accessMode === 'observe' ? s.modeObserve : s.modeOff;
  const color = accessMode === 'enforce' ? 'text-[var(--ok)]' : accessMode === 'observe' ? 'text-[var(--brand-b-ink)]' : 'text-[var(--warn)]';
  let text: string;
  if (accessMode === 'off') {
    text =
      'Enforcement is off. Everything set here is saved but nothing is checked or logged yet. Finish setup, then turn on observe mode.';
  } else if (accessMode === 'observe') {
    text =
      'Observe mode. Every decision is logged and nothing is blocked. Check the Access log for “would block” entries before enforcing.';
  } else {
    text = `Enforcing on ${status.enforcedSurfaces.join(', ') || 'no surfaces'}. People can only use what this policy allows.`;
  }
  if (legacyOpen && accessMode !== 'off') {
    text += ' No path grants exist yet, so all unlabelled data is still open.';
  }
  return (
    <div className={cn(s.modeBanner, tone)} role="status">
      <span className={cn(s.modeDot, color)} aria-hidden="true" />
      <p className="text-foreground">
        <span className="font-semibold capitalize">{accessMode === 'off' ? 'Not enforced' : accessMode}</span>
        <span className="text-muted-foreground"> · {text}</span>
      </p>
    </div>
  );
}

export default function DataAccessPage() {
  // View (not Manage) on Govern → Data access: every tab is read-only. The APIs refuse changes either way.
  const readOnly = useSectionLevel('govern.data-access') !== 'manage';
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const initialUser = searchParams.get('user');
  const [tab, setTab] = useState<ConsoleTab>(
    initialUser ? 'people' : initialTab && TAB_IDS.has(initialTab) ? (initialTab as ConsoleTab) : 'map',
  );
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Reload shared data. Sets state only after the request returns. */
  const refresh = useCallback(async () => {
    try {
      const [st, d, u] = await Promise.all([
        accessFetch<AccessStatus>('/api/access/status'),
        accessFetch<{ departments: Department[] }>('/api/access/departments'),
        accessFetch<{ users: Person[] }>('/api/access/users'),
      ]);
      setStatus(st);
      setDepartments(d.departments);
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

  const tabCount = (id: ConsoleTab): number | null => {
    if (!status) return null;
    if (id === 'map') return status.counts.departmentGrants;
    if (id === 'people') return people.length;
    if (id === 'labels') return status.counts.labels;
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
            <h1 className="text-title-section">Data access</h1>
            <p className="mt-1 max-w-[80ch] text-size-ui text-muted-foreground">
              Map catalogs, schemas, and tables to departments, then give each person their departments. Separate from
              app roles: being an Admin gives no data.
            </p>
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

        {status ? <ModeBanner status={status} /> : null}

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
          ) : tab === 'setup' ? (
            <OverviewView status={status} onGo={setTab} />
          ) : tab === 'map' ? (
            <DataMapView
              departments={departments}
              roles={status.roles}
              isPlatformAdmin={status.me.platformAdmin}
              onChanged={refresh}
            />
          ) : tab === 'people' ? (
            <PeopleView
              people={people}
              departments={departments}
              roles={status.roles}
              meId={status.me.userId}
              isPlatformAdmin={status.me.platformAdmin}
              focusId={initialUser}
              onChanged={refresh}
            />
          ) : tab === 'labels' ? (
            <LabelsView isPlatformAdmin={status.me.platformAdmin} onChanged={refresh} />
          ) : (
            <AccessLogView people={people} />
          )}
        </section>
        </ConsoleReadOnlyContext.Provider>
      </div>
    </div>
  );
}
