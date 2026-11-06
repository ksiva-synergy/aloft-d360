'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, personName, reasonText, runAsync, type DenyReason, type Person } from './api';
import { Empty, Mono, Segmented } from './parts';
import s from './console.module.css';

type DecisionRow = {
  id: string;
  ts: string;
  userId: string | null;
  surface: string;
  level: string;
  decision: string;
  reason: string | null;
  mode: string;
  tier: string | null;
  paths: string[];
};

const SURFACE_LABEL: Record<string, string> = {
  sql: 'Inspector SQL',
  semantic: 'Semantic query',
  dashboard: 'Dashboard',
  export: 'Export',
  describe: 'Schema lookup',
  estate: 'Estate pages',
};

export function AccessLogView({ people }: { people: Person[] }) {
  const [rows, setRows] = useState<DecisionRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'deny'>('deny');
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const load = useCallback(async (after?: string | null) => {
    const q = new URLSearchParams({ limit: '100' });
    if (after) q.set('cursor', after);
    const data = await accessFetch<{ decisions: DecisionRow[]; nextCursor: string | null }>(`/api/access/decisions?${q}`);
    setRows((prev) => (after && prev ? [...prev, ...data.decisions] : data.decisions));
    setCursor(data.nextCursor);
  }, []);

  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load the log')));
  }, [load]);

  const shown = (rows ?? []).filter((r) => filter === 'all' || r.decision === 'deny');

  return (
    <div className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-caption text-muted-foreground">
          Denials, and allows on Confidential or Restricted data. In observe mode a “deny” here was allowed through and
          shows what enforcement would block. Review these before switching to enforce.
        </p>
        <Segmented<'all' | 'deny'>
          ariaLabel="Filter decisions"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'deny', label: 'Denials' },
            { value: 'all', label: 'Everything' },
          ]}
        />
      </div>
      {error ? (
        <p className={s.errorText} role="alert">
          {error}
        </p>
      ) : rows === null ? (
        <p className="text-caption text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <Empty icon={<ScrollText className="h-8 w-8 opacity-40" />}>
          {filter === 'deny' ? 'No denials recorded.' : 'No decisions recorded.'} Decisions are only logged while
          ACCESS_MODE is observe or enforce.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--estate-border)]">
          <table className={userStyles.table}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Person</th>
                <th scope="col">Where</th>
                <th scope="col">Result</th>
                <th scope="col">Tables</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const p = r.userId ? byId.get(r.userId) : undefined;
                const deny = r.decision === 'deny';
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-size-ui">{new Date(r.ts).toLocaleString()}</td>
                    <td className="text-size-ui">{r.userId ? personName(p, `${r.userId.slice(0, 8)}…`) : 'System'}</td>
                    <td className="text-size-ui">
                      {SURFACE_LABEL[r.surface] ?? r.surface}
                      <span className="text-muted-foreground"> · {r.level}</span>
                    </td>
                    <td className="text-size-ui">
                      <span className={cn(s.chip, deny ? s.chipBad : s.chipOk)}>
                        {deny ? reasonText(r.reason as DenyReason) : `Allowed${r.tier && r.tier !== 'internal' ? ` · ${r.tier}` : ''}`}
                      </span>
                      {r.mode === 'observe' && deny ? (
                        <span className="ml-1 text-caption text-muted-foreground">would block</span>
                      ) : null}
                    </td>
                    <td className="text-size-ui">
                      {r.paths.length ? (
                        <span className="flex flex-col gap-0.5">
                          {r.paths.slice(0, 3).map((p2) => (
                            <Mono key={p2}>{p2}</Mono>
                          ))}
                          {r.paths.length > 3 ? (
                            <span className="text-caption text-muted-foreground">+{r.paths.length - 3} more</span>
                          ) : null}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cursor ? (
        <Button type="button" variant="outline" className={cn(userStyles.secondaryButton, 'mt-3')} onClick={() => void load(cursor)}>
          Load older
        </Button>
      ) : null}
    </div>
  );
}
