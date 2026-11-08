'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import userStyles from '@/components/users/users.module.css';
import { RequestList, LEVEL_TEXT, type AccessRequestRow } from '@/components/access/requests/RequestList';
import { accessFetch, runAsync, send, type Person } from './api';
import { AccessLogView } from './AccessLogView';
import { HealthView } from './HealthView';
import s from './console.module.css';

type Sub = 'inbox' | 'history' | 'log' | 'health';
type Days = 30 | 60 | 90;

/**
 * Requests & log: requests waiting for me, the request history (UI shows at most the last 90 days;
 * every row stays in the database, D14), and the decision log.
 */
export function RequestsView({ people, meId, isPlatformAdmin = false }: { people: Person[]; meId: string; isPlatformAdmin?: boolean }) {
  const [sub, setSub] = useState<Sub>('inbox');
  const [days, setDays] = useState<Days>(30);
  const [inbox, setInbox] = useState<AccessRequestRow[] | null>(null);
  const [history, setHistory] = useState<AccessRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);

  async function runChecks() {
    setCheckMsg(null);
    try {
      const r = await send<{ done: Record<string, number> }>('/api/access/requests/maintenance', 'POST', {});
      const d = r.done;
      setCheckMsg(`Escalated ${d.escalate}, expired ${d.expire}, warned ${d.expiring_soon}, ended ${d.access_ended}.`);
      await refresh();
    } catch (e) {
      setCheckMsg(e instanceof Error ? e.message : 'Could not run the checks');
    }
  }

  const loadInbox = useCallback(async () => {
    const r = await accessFetch<{ requests: AccessRequestRow[] }>('/api/access/requests?view=inbox');
    setInbox(r.requests);
  }, []);
  const loadHistory = useCallback(async (d: Days) => {
    const r = await accessFetch<{ requests: AccessRequestRow[] }>(`/api/access/requests?view=history&days=${d}`);
    setHistory(r.requests);
  }, []);

  useEffect(() => {
    runAsync(() => loadInbox().catch((e) => setError(e instanceof Error ? e.message : 'Could not load requests')));
  }, [loadInbox]);
  useEffect(() => {
    if (sub !== 'history') return;
    runAsync(() => loadHistory(days).catch((e) => setError(e instanceof Error ? e.message : 'Could not load history')));
  }, [sub, days, loadHistory]);

  const refresh = async () => {
    await Promise.all([loadInbox(), sub === 'history' ? loadHistory(days) : Promise.resolve()]);
  };

  function exportCsv() {
    const rows = history ?? [];
    const head = ['number', 'requester', 'target', 'level', 'duration_days', 'status', 'reason', 'ticket', 'approvers', 'decided_by', 'decided_at', 'granted_until', 'created_at'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      head.join(','),
      ...rows.map((r) =>
        [r.number, r.requester, r.target, LEVEL_TEXT[r.level], r.durationDays ?? '', r.status, r.reason, r.ticketRef, r.approvers.join('; '), r.decidedBy, r.decidedAt, r.grantedUntil, r.createdAt].map(esc).join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `access-requests-last-${days}-days.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const waiting = inbox?.filter((r) => r.canDecide).length ?? 0;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className={s.seg} role="tablist" aria-label="Requests and log">
          {(
            [
              ['inbox', `To approve${waiting ? ` (${waiting})` : ''}`],
              ['history', 'Request history'],
              ['log', 'Decision log'],
              ['health', 'Column check health'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={sub === id} className={cn(s.segBtn, sub === id && s.segBtnActive)} onClick={() => setSub(id)}>
              {label}
            </button>
          ))}
        </div>
        {sub === 'inbox' && isPlatformAdmin ? (
          <button type="button" className={cn(userStyles.secondaryButton, 'ml-auto')} onClick={() => void runChecks()} title="Escalate after 3 days, expire after 14, warn before access ends">
            Run checks now
          </button>
        ) : null}
        {checkMsg ? <span className="text-caption text-muted-foreground" role="status">{checkMsg}</span> : null}
        {sub === 'history' ? (
          <>
            <div className={s.seg} role="radiogroup" aria-label="Period">
              {([30, 60, 90] as Days[]).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={days === d} className={cn(s.segBtn, days === d && s.segBtnActive)} onClick={() => setDays(d)}>
                  Last {d} days
                </button>
              ))}
            </div>
            <button type="button" className={cn(userStyles.secondaryButton, 'ml-auto inline-flex items-center gap-1.5')} disabled={!history?.length} onClick={exportCsv}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Export CSV
            </button>
          </>
        ) : null}
      </div>

      {error ? <p className={s.errorText}>{error}</p> : null}

      {sub === 'log' ? (
        <AccessLogView people={people} />
      ) : sub === 'health' ? (
        <HealthView />
      ) : (
        <div className={cn(s.card, 'overflow-hidden')}>
          {sub === 'inbox' ? (
            inbox === null ? (
              <p className="p-4 text-caption text-muted-foreground">Loading…</p>
            ) : (
              <RequestList requests={inbox} meId={meId} empty="Nothing waiting for you." onChanged={refresh} />
            )
          ) : history === null ? (
            <p className="p-4 text-caption text-muted-foreground">Loading…</p>
          ) : (
            <RequestList requests={history} meId={meId} empty={`No requests in the last ${days} days.`} onChanged={refresh} />
          )}
        </div>
      )}
      {sub === 'history' ? <p className="text-caption text-muted-foreground">Every request is kept; this view shows up to the last 90 days.</p> : null}
    </div>
  );
}
