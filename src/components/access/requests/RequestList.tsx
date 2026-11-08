'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Lock, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, runAsync, send } from '@/components/access/console/api';
import s from '@/components/access/console/console.module.css';

/* Access requests: one list used by the approver inbox, history, and "My data access". */

export type AccessRequestRow = {
  id: string;
  number: string;
  requesterId: string;
  requester: string;
  targetType: 'tag' | 'path';
  target: string | null;
  level: 'aggregate' | 'full' | 'query' | 'export';
  durationDays: number | null;
  reason: string;
  ticketRef: string | null;
  status: 'pending' | 'info_requested' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  approvers: string[];
  canDecide: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  grantedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

type Event = { id: string; type: string; actor: string; ts: string; comment: string | null };

export const LEVEL_TEXT: Record<AccessRequestRow['level'], string> = {
  full: 'Exact values',
  aggregate: 'Totals only',
  query: 'Use',
  export: 'Use + export',
};

const STATUS: Record<AccessRequestRow['status'], { text: string; cls?: string }> = {
  pending: { text: 'Waiting', cls: s.chipBrand },
  info_requested: { text: 'Question asked', cls: s.chipConfidential },
  approved: { text: 'Approved', cls: s.chipOk },
  rejected: { text: 'Turned down', cls: s.chipBad },
  cancelled: { text: 'Cancelled' },
  expired: { text: 'Expired' },
};

const EVENT_TEXT: Record<string, string> = {
  requested: 'asked',
  routed: 'sent to approvers',
  info_asked: 'asked a question',
  info_given: 'answered',
  approval_recorded: 'approved (first of two)',
  approved: 'approved',
  approved_with_changes: 'approved with changes',
  granted: 'access given',
  rejected: 'turned down',
  cancelled: 'cancelled',
  expired: 'expired',
  escalated: 'escalated',
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const duration = (d: number | null) => (d ? `${d} days` : 'no end date');

export function RequestList({
  requests,
  meId,
  empty,
  onChanged,
}: {
  requests: AccessRequestRow[];
  meId: string;
  empty: string;
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (requests.length === 0) return <p className="p-4 text-caption text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-[var(--estate-border)]">
      {requests.map((r) => (
        <li key={r.id}>
          <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)]" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <ChevronRight className={cn('mt-1 h-3.5 w-3.5 shrink-0 transition-transform', open === r.id && 'rotate-90')} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-caption text-muted-foreground">{r.number}</span>
                {r.targetType === 'tag' ? <Lock className="h-3.5 w-3.5 text-[var(--brand-a-ink)]" aria-hidden="true" /> : <Table2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                <span className="truncate font-medium">{r.target}</span>
                <span className="text-caption text-muted-foreground">
                  {LEVEL_TEXT[r.level]} · {duration(r.durationDays)}
                </span>
                <span className={cn(s.chip, STATUS[r.status].cls)}>{STATUS[r.status].text}</span>
              </span>
              <span className="block truncate text-caption text-muted-foreground">
                {r.requesterId === meId ? 'You' : r.requester} · {when(r.createdAt)} · “{r.reason}”
              </span>
            </span>
          </button>
          {open === r.id ? <RequestDetail request={r} meId={meId} onChanged={onChanged} /> : null}
        </li>
      ))}
    </ul>
  );
}

function RequestDetail({ request: r, meId, onChanged }: { request: AccessRequestRow; meId: string; onChanged: () => Promise<void> | void }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  useEffect(() => {
    runAsync(() => accessFetch<{ events: Event[] }>(`/api/access/requests/${r.id}`).then((d) => setEvents(d.events), () => setEvents([])));
  }, [r.id, r.status, r.updatedAt]);
  const mine = r.requesterId === meId;
  const isOpen = r.status === 'pending' || r.status === 'info_requested';

  return (
    <div className="flex flex-col gap-3 bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] px-4 pb-4 pl-10">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-caption sm:grid-cols-2">
        <div>
          <dt className="inline text-muted-foreground">Why: </dt>
          <dd className="inline">{r.reason}</dd>
        </div>
        {r.ticketRef ? (
          <div>
            <dt className="inline text-muted-foreground">Ticket: </dt>
            <dd className="inline">{r.ticketRef}</dd>
          </div>
        ) : null}
        <div>
          <dt className="inline text-muted-foreground">Approvers: </dt>
          <dd className="inline">{r.approvers.join(', ') || '—'}</dd>
        </div>
        {r.grantedUntil ? (
          <div>
            <dt className="inline text-muted-foreground">Access until: </dt>
            <dd className="inline">{new Date(r.grantedUntil).toLocaleDateString()}</dd>
          </div>
        ) : null}
      </dl>

      <ol className="flex flex-col gap-1 border-l border-[var(--estate-border)] pl-3" aria-label="History">
        {events === null ? (
          <li className="text-caption text-muted-foreground">Loading history…</li>
        ) : (
          events.map((e) => (
            <li key={e.id} className="text-caption">
              <span className="text-muted-foreground">{when(e.ts)}</span> · <span className="font-medium">{e.actor}</span> {EVENT_TEXT[e.type] ?? e.type}
              {e.comment ? <span className="text-muted-foreground"> — “{e.comment}”</span> : null}
            </li>
          ))
        )}
      </ol>

      {r.canDecide ? <DecideForm request={r} onChanged={onChanged} /> : null}
      {mine && isOpen ? <RequesterActions request={r} onChanged={onChanged} /> : null}
    </div>
  );
}

function DecideForm({ request: r, onChanged }: { request: AccessRequestRow; onChanged: () => Promise<void> | void }) {
  const narrower: AccessRequestRow['level'][] = r.targetType === 'tag' ? (r.level === 'full' ? ['full', 'aggregate'] : ['aggregate']) : r.level === 'export' ? ['export', 'query'] : ['query'];
  const shorter = ([7, 30, 90] as const).filter((d) => r.durationDays === null || d <= r.durationDays);
  const [level, setLevel] = useState(r.level);
  const [days, setDays] = useState<number | null>(r.durationDays);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go(action: 'approve' | 'reject' | 'ask_info') {
    setBusy(true);
    setMsg(null);
    try {
      const body =
        action === 'approve'
          ? { action, level, durationDays: days, comment: comment.trim() || null }
          : { action, comment: comment.trim() };
      const res = await send<{ waitingForSecondApproval?: boolean }>(`/api/access/requests/${r.id}`, 'POST', body);
      if (res?.waitingForSecondApproval) setMsg('Recorded. This data needs a second approver (a platform admin).');
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2 text-caption">
        <span className="text-muted-foreground">Give</span>
        <select className={cn(userStyles.input, 'h-8 w-auto py-0')} value={level} onChange={(e) => setLevel(e.target.value as AccessRequestRow['level'])} aria-label="Level to approve">
          {narrower.map((l) => (
            <option key={l} value={l}>
              {LEVEL_TEXT[l]}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">for</span>
        <select
          className={cn(userStyles.input, 'h-8 w-auto py-0')}
          value={days === null ? 'none' : String(days)}
          onChange={(e) => setDays(e.target.value === 'none' ? null : Number(e.target.value))}
          aria-label="How long to approve"
        >
          {shorter.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
          {r.durationDays === null ? <option value="none">No end date</option> : null}
        </select>
      </div>
      <Input className={userStyles.input} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (needed to turn down or ask a question)" aria-label="Comment" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={userStyles.primary} disabled={busy} onClick={() => void go('approve')}>
          Approve
        </button>
        <button type="button" className={userStyles.secondaryButton} disabled={busy} onClick={() => void go('ask_info')}>
          Ask a question
        </button>
        <button type="button" className={cn(userStyles.secondaryButton, 'text-[var(--bad)]')} disabled={busy} onClick={() => void go('reject')}>
          Turn down
        </button>
        {msg ? <span className="text-caption text-muted-foreground" role="status">{msg}</span> : null}
      </div>
    </div>
  );
}

function RequesterActions({ request: r, onChanged }: { request: AccessRequestRow; onChanged: () => Promise<void> | void }) {
  const [answer, setAnswer] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  async function go(action: 'info_given' | 'cancel') {
    setMsg(null);
    try {
      await send(`/api/access/requests/${r.id}`, 'POST', action === 'cancel' ? { action } : { action, comment: answer.trim() });
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {r.status === 'info_requested' ? (
        <>
          <Input className={cn(userStyles.input, 'min-w-[220px] flex-1')} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" aria-label="Your answer" />
          <button type="button" className={userStyles.primary} onClick={() => void go('info_given')}>
            Send answer
          </button>
        </>
      ) : null}
      <button type="button" className={s.linkBtn} onClick={() => void go('cancel')}>
        Cancel request
      </button>
      {msg ? <span className={s.errorText}>{msg}</span> : null}
    </div>
  );
}
