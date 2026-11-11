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
  /** Stakeholder label (no warehouse path). */
  targetLabel?: string | null;
  /** What a path grant covers (approvers). */
  scopeSummary?: string | null;
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
  requester_note: 'added information',
  approver_note: 'sent a message',
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

/** Split the composed purpose text into the pieces a reader cares about. */
export function parseRequestReason(reason: string): { question: string; why: string | null } {
  const whyM = reason.match(/(?:^|\n+)\s*Why my role needs it:\s*([\s\S]*)$/i);
  let rest = (whyM ? reason.slice(0, whyM.index) : reason).trim();
  const why = whyM?.[1]?.trim() || null;
  rest = rest
    .replace(/\n*\s*Agent-identified tables? for this work:[^\n]*/i, '')
    .replace(/\n*\s*Linked \d+ requests \(ref [^)]*\)\.?/i, '')
    .replace(/^\s*What I need to do:\s*/i, '')
    .replace(/^\s*(?:Question in Ask Data|Question in Data Chat|Question in Chat|Question in Ask|Inspector question):\s*/i, '')
    .trim();
  const lines: string[] = [];
  for (const line of rest.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (lines.some((l) => l.includes(line))) continue;
    lines.push(line);
  }
  return { question: lines.join('\n'), why };
}

const DOT: Record<string, string> = {
  approved: 'bg-[var(--ok)]',
  granted: 'bg-[var(--ok)]',
  rejected: 'bg-[var(--bad)]',
  info_asked: 'bg-[var(--warn)]',
};

function Timeline({ events }: { events: Event[] | null }) {
  return (
    <div className="flex flex-col gap-2" aria-label="Activity">
      <p className="text-size-caption font-semibold uppercase tracking-wide text-muted-foreground">Activity</p>
      {events === null ? (
        <p className="text-caption text-muted-foreground">Loading…</p>
      ) : (
        <ol className="relative flex flex-col gap-3 pl-5 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-[var(--estate-border)]" aria-label="History">
          {events.map((e) => {
            const showComment = !!e.comment?.trim() && e.type !== 'requested';
            return (
              <li key={e.id} className="relative text-caption">
                <span className={cn('absolute -left-5 top-[5px] h-[11px] w-[11px] rounded-full border-2 border-[var(--estate-surface)]', DOT[e.type] ?? 'bg-[var(--brand-a)]')} aria-hidden="true" />
                <p>
                  <span className="font-medium text-foreground">{e.actor}</span>{' '}
                  <span className="text-muted-foreground">{EVENT_TEXT[e.type] ?? e.type}</span>
                </p>
                <p className="text-size-caption text-muted-foreground">{when(e.ts)}</p>
                {showComment ? (
                  <p className="mt-1 whitespace-pre-wrap rounded-[8px] bg-[var(--surface-2)] px-2.5 py-1.5 text-foreground">{e.comment}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-size-caption font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-caption text-foreground">{children}</dd>
    </div>
  );
}

function PurposeBlock({ reason }: { reason: string }) {
  const { question, why } = parseRequestReason(reason);
  return (
    <div className="flex flex-col gap-2">
      {question ? (
        <blockquote className="whitespace-pre-wrap rounded-r-[8px] border-l-[3px] border-[var(--brand-a)] bg-[var(--brand-a-soft)] px-3 py-2 text-caption text-foreground">
          {question}
        </blockquote>
      ) : null}
      {why ? (
        <p className="text-caption">
          <span className="text-muted-foreground">Why their role needs it: </span>
          {why}
        </p>
      ) : null}
    </div>
  );
}

export function isAccessRequestBundleRef(ticketRef: string | null | undefined): ticketRef is string {
  return !!ticketRef?.startsWith('bundle-');
}

/** Fold multi-table submissions (shared `bundle-*` ticketRef) into one row per bundle. */
export function groupAccessRequests(requests: AccessRequestRow[]): Array<
  | { kind: 'single'; request: AccessRequestRow }
  | { kind: 'bundle'; ticketRef: string; requests: AccessRequestRow[] }
> {
  const byRef = new Map<string, AccessRequestRow[]>();
  for (const r of requests) {
    if (!isAccessRequestBundleRef(r.ticketRef)) continue;
    const list = byRef.get(r.ticketRef) ?? [];
    list.push(r);
    byRef.set(r.ticketRef, list);
  }
  const out: ReturnType<typeof groupAccessRequests> = [];
  const seen = new Set<string>();
  for (const r of requests) {
    if (isAccessRequestBundleRef(r.ticketRef)) {
      const group = byRef.get(r.ticketRef)!;
      if (group.length > 1) {
        if (seen.has(r.ticketRef)) continue;
        seen.add(r.ticketRef);
        out.push({ kind: 'bundle', ticketRef: r.ticketRef, requests: group });
        continue;
      }
    }
    out.push({ kind: 'single', request: r });
  }
  return out;
}

function bundleStatus(requests: AccessRequestRow[]): AccessRequestRow['status'] {
  const order: AccessRequestRow['status'][] = ['pending', 'info_requested', 'approved', 'rejected', 'cancelled', 'expired'];
  const set = new Set(requests.map((r) => r.status));
  return order.find((s) => set.has(s)) ?? requests[0]!.status;
}

const ONE_LINE = 'overflow-hidden text-ellipsis whitespace-nowrap';

function RowHead({
  open,
  onToggle,
  numbers,
  icon,
  title,
  meta,
  status,
  who,
  summary,
}: {
  open: boolean;
  onToggle: () => void;
  numbers: string;
  icon: React.ReactNode;
  title: string;
  meta: string;
  status: AccessRequestRow['status'];
  who: string;
  summary: string;
}) {
  return (
    <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)]" aria-expanded={open} onClick={onToggle}>
      <ChevronRight className={cn('mt-1 h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {icon}
          <span className={cn(ONE_LINE, 'font-medium')}>{title}</span>
          <span className="shrink-0 text-size-caption text-muted-foreground">{numbers}</span>
          <span className={cn(s.chip, STATUS[status].cls, 'ml-auto shrink-0')}>{STATUS[status].text}</span>
        </span>
        <span className="mt-0.5 block text-caption text-muted-foreground">
          {meta} · {who}
        </span>
        {summary ? <span className={cn(ONE_LINE, 'mt-0.5 block text-caption text-foreground/80')}>{summary}</span> : null}
      </span>
    </button>
  );
}

export function RequestList({
  requests,
  meId,
  empty,
  onChanged,
  initialOpenId,
}: {
  requests: AccessRequestRow[];
  meId: string;
  empty: string;
  onChanged: () => Promise<void> | void;
  /** Deep link from notifications, e.g. ?open=<request id>. */
  initialOpenId?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!initialOpenId || requests.length === 0) return;
    const bundle = groupAccessRequests(requests).find(
      (g) => g.kind === 'bundle' && g.requests.some((r) => r.id === initialOpenId),
    );
    if (bundle?.kind === 'bundle') setOpen(`bundle:${bundle.ticketRef}`);
    else if (requests.some((r) => r.id === initialOpenId)) setOpen(initialOpenId);
  }, [initialOpenId, requests]);
  const groups = groupAccessRequests(requests);
  if (requests.length === 0) return <p className="p-4 text-caption text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-[var(--estate-border)]">
      {groups.map((g) => {
        if (g.kind === 'single') {
          const r = g.request;
          return (
            <li key={r.id}>
              <RowHead
                open={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
                numbers={r.number}
                icon={r.targetType === 'tag' ? <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--brand-a-ink)]" aria-hidden="true" /> : <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                title={r.targetLabel ?? r.target ?? r.number}
                meta={`${LEVEL_TEXT[r.level]} · ${duration(r.durationDays)}`}
                status={r.status}
                who={`${r.requesterId === meId ? 'You' : r.requester} · ${when(r.createdAt)}`}
                summary={parseRequestReason(r.reason).question.replace(/\s+/g, ' ')}
              />
              {open === r.id ? <RequestDetail request={r} meId={meId} onChanged={onChanged} /> : null}
            </li>
          );
        }
        const rows = g.requests;
        const head = rows[0]!;
        const openKey = `bundle:${g.ticketRef}`;
        const status = bundleStatus(rows);
        const numbers = rows.map((r) => r.number).join(', ');
        const labels = rows.map((r) => r.targetLabel ?? r.target).filter(Boolean).join('; ');
        return (
          <li key={openKey}>
            <RowHead
              open={open === openKey}
              onToggle={() => setOpen(open === openKey ? null : openKey)}
              numbers={numbers}
              icon={<Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              title={`${rows.length} tables`}
              meta={`${LEVEL_TEXT[head.level]} · ${duration(head.durationDays)}`}
              status={status}
              who={`${head.requesterId === meId ? 'You' : head.requester} · ${when(head.createdAt)}`}
              summary={labels}
            />
            {open === openKey ? (
              <BundleDetail ticketRef={g.ticketRef} requests={rows} meId={meId} onChanged={onChanged} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function BundleDetail({
  ticketRef,
  requests,
  meId,
  onChanged,
}: {
  ticketRef: string;
  requests: AccessRequestRow[];
  meId: string;
  onChanged: () => Promise<void> | void;
}) {
  const head = requests[0]!;
  return (
    <div className="flex flex-col gap-4 bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] px-4 pb-4 pl-10">
      <p className="text-caption text-muted-foreground">
        Same need, {requests.length} tables · ref <span className="font-mono">{ticketRef}</span>
      </p>
      <div className="rounded-[8px] border border-[var(--estate-border)] bg-[var(--surface-2)] px-3 py-2 text-caption">
        <p className="font-medium text-foreground">Agent-identified tables for this work</p>
        <ul className="mt-1 list-inside list-disc text-muted-foreground">
          {requests.map((r) => (
            <li key={r.id}>{r.targetLabel ?? r.target ?? r.number}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-size-caption font-semibold uppercase tracking-wide text-muted-foreground">Purpose</p>
        <PurposeBlock reason={head.reason} />
      </div>
      <ul className="flex flex-col gap-3" aria-label="Tables in this bundle">
        {requests.map((r) => (
          <li key={r.id} className="rounded-[8px] border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3">
            <p className="mb-2 flex flex-wrap items-center gap-2 text-caption">
              <span className="text-muted-foreground">{r.number}</span>
              <span className="font-medium">{r.targetLabel ?? r.target}</span>
              <span className={cn(s.chip, STATUS[r.status].cls)}>{STATUS[r.status].text}</span>
            </p>
            {r.target ? (
              <p className="mb-2 font-mono text-size-caption text-muted-foreground" title="Technical path">
                {r.target}
              </p>
            ) : null}
            <RequestDetail request={r} meId={meId} onChanged={onChanged} nested />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestDetail({
  request: r,
  meId,
  onChanged,
  nested,
}: {
  request: AccessRequestRow;
  meId: string;
  onChanged: () => Promise<void> | void;
  nested?: boolean;
}) {
  const [events, setEvents] = useState<Event[] | null>(null);
  useEffect(() => {
    runAsync(() => accessFetch<{ events: Event[] }>(`/api/access/requests/${r.id}`).then((d) => setEvents(d.events), () => setEvents([])));
  }, [r.id, r.status, r.updatedAt]);
  const mine = r.requesterId === meId;
  const isOpen = r.status === 'pending' || r.status === 'info_requested';

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        nested ? 'px-0 pb-0 pl-0' : 'bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] px-4 pb-4 pl-10',
      )}
    >
      <div className={cn('grid gap-4', !nested && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
        <div className="flex min-w-0 flex-col gap-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-[10px] border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3 sm:grid-cols-2">
            {r.targetType === 'path' && r.target && !nested ? (
              <Field label="Data requested" wide>
                <span className="font-medium">{r.targetLabel ?? r.target}</span>
                {r.scopeSummary ? <span className="mt-0.5 block text-muted-foreground">{r.scopeSummary}</span> : null}
                <code className="mt-1 block break-all font-mono text-size-caption text-muted-foreground" title="Technical path for admins">{r.target}</code>
              </Field>
            ) : r.targetType === 'path' && nested && r.scopeSummary ? (
              <Field label="Scope" wide>
                <span className="text-muted-foreground">{r.scopeSummary}</span>
              </Field>
            ) : r.targetType === 'tag' ? (
              <Field label="Protection" wide>{r.targetLabel ?? r.target}</Field>
            ) : null}
            {!nested ? <Field label="Access level">{LEVEL_TEXT[r.level]}</Field> : null}
            {!nested ? <Field label="Duration">{duration(r.durationDays)}</Field> : null}
            <Field label="Approvers" wide>
              {r.approvers.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {r.approvers.map((a) => (
                    <span key={a} className="rounded-full bg-[var(--surface-2)] px-2 py-0.5">{a}</span>
                  ))}
                </span>
              ) : (
                '—'
              )}
            </Field>
            {r.grantedUntil ? <Field label="Access until">{new Date(r.grantedUntil).toLocaleDateString()}</Field> : null}
            {!nested && r.ticketRef && !isAccessRequestBundleRef(r.ticketRef) ? <Field label="Ticket">{r.ticketRef}</Field> : null}
          </dl>
          {!nested ? (
            <div>
              <p className="mb-1 text-size-caption font-semibold uppercase tracking-wide text-muted-foreground">Purpose</p>
              <PurposeBlock reason={r.reason} />
            </div>
          ) : null}
        </div>
        <Timeline events={events} />
      </div>

      {r.canDecide ? <DecideForm request={r} onChanged={onChanged} events={events} /> : null}
      {mine && isOpen ? <RequesterActions request={r} onChanged={onChanged} events={events} /> : null}
    </div>
  );
}

function DecideForm({ request: r, onChanged, events }: { request: AccessRequestRow; onChanged: () => Promise<void> | void; events: Event[] | null }) {
  const narrower: AccessRequestRow['level'][] = r.targetType === 'tag' ? (r.level === 'full' ? ['full', 'aggregate'] : ['aggregate']) : r.level === 'export' ? ['export', 'query'] : ['query'];
  const shorter = ([7, 30, 90] as const).filter((d) => r.durationDays === null || d <= r.durationDays);
  const [level, setLevel] = useState(r.level);
  const [days, setDays] = useState<number | null>(r.durationDays);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const awaitingAnswer = r.status === 'info_requested';

  async function go(action: 'approve' | 'reject' | 'ask_info' | 'approver_note') {
    setBusy(true);
    setMsg(null);
    try {
      if (action === 'approver_note' || action === 'ask_info' || action === 'reject') {
        if (comment.trim().length < 5) {
          setMsg('Write your message in the comment box (at least 5 characters).');
          setBusy(false);
          return;
        }
      }
      const body =
        action === 'approve'
          ? { action, level, durationDays: days, comment: comment.trim() || null }
          : { action, comment: comment.trim() };
      const res = await send<{ waitingForSecondApproval?: boolean }>(`/api/access/requests/${r.id}`, 'POST', body);
      if (action === 'approver_note' || action === 'ask_info') setComment('');
      if (res?.waitingForSecondApproval) setMsg('Recorded. This data needs a second approver (a platform admin).');
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const lastFromRequester = events?.filter((e) => e.type === 'info_given' || e.type === 'requester_note').at(-1);

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3">
      {awaitingAnswer ? (
        <p className="text-caption text-[var(--warn)]">Waiting for the requester to answer your question before you can approve.</p>
      ) : null}
      {lastFromRequester?.comment ? (
        <p className="text-caption text-muted-foreground">
          <span className="font-medium text-foreground">Latest from requester: </span>&ldquo;{lastFromRequester.comment}&rdquo;
        </p>
      ) : null}
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
      <Input
        className={userStyles.input}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Message or question to the requester"
        aria-label="Message to requester"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={userStyles.primary} disabled={busy || awaitingAnswer} onClick={() => void go('approve')}>
          Approve
        </button>
        <button type="button" className={userStyles.secondaryButton} disabled={busy} onClick={() => void go('approver_note')}>
          Send message
        </button>
        <button type="button" className={userStyles.secondaryButton} disabled={busy} onClick={() => void go('ask_info')}>
          Ask question (needs answer)
        </button>
        <button type="button" className={cn(userStyles.secondaryButton, 'text-[var(--bad)]')} disabled={busy} onClick={() => void go('reject')}>
          Turn down
        </button>
        {msg ? <span className="text-caption text-muted-foreground" role="status">{msg}</span> : null}
      </div>
    </div>
  );
}

function RequesterActions({ request: r, onChanged, events }: { request: AccessRequestRow; onChanged: () => Promise<void> | void; events: Event[] | null }) {
  const [answer, setAnswer] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const lastQuestion = events?.filter((e) => e.type === 'info_asked').at(-1);
  async function go(action: 'info_given' | 'follow_up' | 'cancel') {
    setMsg(null);
    try {
      if (action !== 'cancel' && answer.trim().length < 5) {
        setMsg('Write at least a few words.');
        return;
      }
      await send(
        `/api/access/requests/${r.id}`,
        'POST',
        action === 'cancel' ? { action } : { action, comment: answer.trim() },
      );
      setAnswer('');
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    }
  }
  const canReply = r.status === 'info_requested' || r.status === 'pending';
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--estate-border)] bg-[var(--estate-surface)] p-3">
      {lastQuestion?.comment && r.status === 'info_requested' ? (
        <p className="text-caption text-foreground">
          <span className="font-medium">Please answer: </span>
          <span className="text-muted-foreground">&ldquo;{lastQuestion.comment}&rdquo;</span>
        </p>
      ) : null}
      {canReply ? (
        <>
          <label className="text-caption text-muted-foreground" htmlFor={`ticket-reply-${r.id}`}>
            {r.status === 'info_requested' ? 'Your answer' : 'Add more information'}
          </label>
          <Input
            id={`ticket-reply-${r.id}`}
            className={userStyles.input}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={r.status === 'info_requested' ? 'Answer the question above' : 'Anything else approvers should know'}
            aria-label={r.status === 'info_requested' ? 'Your answer' : 'Add more information'}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={userStyles.primary} onClick={() => void go(r.status === 'info_requested' ? 'info_given' : 'follow_up')}>
              {r.status === 'info_requested' ? 'Send answer' : 'Send update'}
            </button>
            <button type="button" className={s.linkBtn} onClick={() => void go('cancel')}>
              Cancel ticket
            </button>
          </div>
        </>
      ) : (
        <button type="button" className={cn(s.linkBtn, 'self-start')} onClick={() => void go('cancel')}>
          Cancel ticket
        </button>
      )}
      {msg ? <span className={s.errorText}>{msg}</span> : null}
    </div>
  );
}
