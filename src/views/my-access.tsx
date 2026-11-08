'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Lock, Search, Send, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useSearchParams } from '@/lib/navigation';
import { useSession } from 'next-auth/react';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, runAsync, send } from '@/components/access/console/api';
import { RequestList, type AccessRequestRow } from '@/components/access/requests/RequestList';
import s from '@/components/access/console/console.module.css';

/* ─────────────────────────────────────────────────────────────────────────────
 * My data access (every signed-in person): what I can use and see, a form to ask for more, and my
 * requests. Links like /my-access?tag=<id> or ?path=<catalog.schema.table> open the form prefilled.
 * ──────────────────────────────────────────────────────────────────────────── */

type Mine = {
  me: { userId: string; roles: string[] };
  groups: { id: string; name: string; expiresAt: string | null }[];
  builtins: { id: string; name: string }[];
  rules: { path: string; access: 'use' | 'export' | 'block'; through: string; expiresAt: string | null }[];
  protections: { id: string; name: string; description: string | null; twoApprovals: boolean; myLevel: 'full' | 'aggregate' | 'none' }[];
};

type Notice = { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: string; read: boolean };

const ACCESS_LABEL = { use: 'Use', export: 'Use + export', block: 'Blocked' } as const;
const MY_LEVEL = { full: 'Exact values', aggregate: 'Totals only', none: 'No access (sees •••)' } as const;

export default function MyAccessPage() {
  const params = useSearchParams();
  const { data: session } = useSession();
  const [mine, setMine] = useState<Mine | null>(null);
  const [requests, setRequests] = useState<AccessRequestRow[] | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, r, n] = await Promise.all([
      accessFetch<Mine>('/api/access/my-access'),
      accessFetch<{ requests: AccessRequestRow[] }>('/api/access/requests?view=mine'),
      accessFetch<{ notifications: Notice[] }>('/api/access/notifications'),
    ]);
    setMine(m);
    setRequests(r.requests);
    setNotices(n.notifications);
  }, []);

  async function markAllRead() {
    await send('/api/access/notifications', 'POST', { all: true });
    setNotices((cur) => cur.map((x) => ({ ...x, read: true })));
  }
  const unread = notices.filter((x) => !x.read);
  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load your access')));
  }, [load]);

  const meId = mine?.me.userId ?? (session?.user as { id?: string } | undefined)?.id ?? '';

  return (
    <div className={cn(userStyles.surface, userStyles.page)}>
      <div className={cn(userStyles.content, 'flex flex-col gap-5')}>
        <header>
          <div className="mb-1 flex items-center gap-2 text-eyebrow uppercase text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            Your account
          </div>
          <h1 className="text-title-section">My data access</h1>
        </header>

        {error ? <p className={s.errorText} role="alert">{error}</p> : null}

        {unread.length ? (
          <section className={s.card} aria-label="Notifications">
            <div className={s.cardHead}>
              <h2 className={s.cardTitle}>New ({unread.length})</h2>
              <button type="button" className={s.linkBtn} onClick={() => void markAllRead()}>
                Mark all read
              </button>
            </div>
            <ul className={cn(s.cardBody, 'flex flex-col gap-1 text-caption')}>
              {unread.map((x) => (
                <li key={x.id}>
                  <span className="font-medium">{x.title}</span>
                  {x.body ? <span className="text-muted-foreground"> — {x.body}</span> : null}
                  <span className="text-muted-foreground"> · {new Date(x.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className={s.card} aria-label="What I can see">
            <div className={s.cardHead}>
              <h2 className={s.cardTitle}>What I can use and see</h2>
            </div>
            <div className={cn(s.cardBody, 'flex flex-col gap-3 text-caption')}>
              {!mine ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <p>
                    <span className="text-muted-foreground">Groups: </span>
                    {[...mine.builtins.map((b) => b.name), ...mine.groups.map((g) => g.name + (g.expiresAt ? ` (until ${new Date(g.expiresAt).toLocaleDateString()})` : ''))].join(', ') || 'none'}
                  </p>
                  <div>
                    <p className="mb-1 text-muted-foreground">Data I can use</p>
                    {mine.rules.length === 0 ? (
                      <p>None yet. Ask for a table below.</p>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {mine.rules.map((r, i) => (
                          <li key={i}>
                            {ACCESS_LABEL[r.access]} <code>{r.path}</code> <span className="text-muted-foreground">· {r.through}</span>
                            {r.expiresAt ? <span className="text-muted-foreground"> · until {new Date(r.expiresAt).toLocaleDateString()}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-muted-foreground">Protected data</p>
                    {mine.protections.length === 0 ? (
                      <p>Nothing is protected.</p>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {mine.protections.map((p) => (
                          <li key={p.id}>
                            <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />
                            <span className="font-medium">{p.name}</span> · {MY_LEVEL[p.myLevel]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          <AskForm mine={mine} initialTag={params.get('tag')} initialPath={params.get('path')} onSent={load} />
        </div>

        <section className={cn(s.card, 'overflow-hidden')} aria-label="My requests">
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>My requests</h2>
          </div>
          {requests === null ? (
            <p className="p-4 text-caption text-muted-foreground">Loading…</p>
          ) : (
            <RequestList requests={requests} meId={meId} empty="You haven't asked for anything yet." onChanged={load} />
          )}
        </section>
      </div>
    </div>
  );
}

function AskForm({ mine, initialTag, initialPath, onSent }: { mine: Mine | null; initialTag: string | null; initialPath: string | null; onSent: () => Promise<void> }) {
  const [kind, setKind] = useState<'tag' | 'path'>(initialPath ? 'path' : 'tag');
  const [tagId, setTagId] = useState(initialTag ?? '');
  const [path, setPath] = useState(initialPath ?? '');
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<{ path: string; kind: string; description?: string | null; match?: string }[] | null>(null);
  const [level, setLevel] = useState<'full' | 'aggregate' | 'query' | 'export'>(initialPath ? 'query' : 'full');
  const [days, setDays] = useState<'7' | '30' | '90' | 'none'>('30');
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const askable = (mine?.protections ?? []).filter((p) => p.myLevel !== 'full');
  const chosenTag = askable.find((p) => p.id === tagId) ?? (askable.length && !tagId ? askable[0] : undefined);
  const twoApprovals = kind === 'tag' && !!chosenTag?.twoApprovals;

  async function find() {
    if (q.trim().length < 2) return;
    const term = encodeURIComponent(q.trim());
    const r = await accessFetch<{ tables: { path: string; kind: string; match?: string }[] }>(`/api/access/my-access?q=${term}`);
    setMatches(r.tables);
    // Then tables with a similar meaning (descriptions, never values).
    void accessFetch<{ tables: { path: string; kind: string; description?: string | null; match?: string }[] }>(`/api/access/my-access?q=${term}&by=meaning`)
      .then((m) => setMatches((cur) => [...(cur ?? []), ...m.tables.filter((t) => !(cur ?? []).some((c) => c.path === t.path))]))
      .catch(() => {});
  }

  async function submit() {
    setMsg(null);
    if (kind === 'tag' && !chosenTag) return setMsg({ ok: false, text: 'Pick what you need.' });
    if (kind === 'path' && !path) return setMsg({ ok: false, text: 'Find and pick a table.' });
    if (reason.trim().length < 20) return setMsg({ ok: false, text: 'Explain why you need it (at least 20 characters).' });
    setBusy(true);
    try {
      const res = await send<{ request: { number: string; approvers: number } }>('/api/access/requests', 'POST', {
        targetType: kind,
        tagId: kind === 'tag' ? chosenTag!.id : null,
        path: kind === 'path' ? path : null,
        level: kind === 'tag' ? (level === 'aggregate' ? 'aggregate' : 'full') : level === 'export' ? 'export' : 'query',
        durationDays: days === 'none' ? null : Number(days),
        reason: reason.trim(),
        ticketRef: ticket.trim() || null,
      });
      setMsg({ ok: true, text: `Sent as ${res.request.number}. It went to ${res.request.approvers} approver${res.request.approvers === 1 ? '' : 's'}; you'll see the answer below.` });
      setReason('');
      setTicket('');
      await onSent();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not send' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.card} aria-label="Ask for access">
      <div className={s.cardHead}>
        <h2 className={s.cardTitle}>Ask for access</h2>
      </div>
      <div className={cn(s.cardBody, 'flex flex-col gap-3')}>
        <div className={s.seg} role="radiogroup" aria-label="What do you need">
          <button type="button" role="radio" aria-checked={kind === 'tag'} className={cn(s.segBtn, kind === 'tag' && s.segBtnActive)} onClick={() => { setKind('tag'); setLevel('full'); }}>
            <Lock className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            Protected data
          </button>
          <button type="button" role="radio" aria-checked={kind === 'path'} className={cn(s.segBtn, kind === 'path' && s.segBtnActive)} onClick={() => { setKind('path'); setLevel('query'); }}>
            <Table2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            A table or schema
          </button>
        </div>

        {kind === 'tag' ? (
          askable.length === 0 ? (
            <p className="text-caption text-muted-foreground">You already see all protected data, or none exists.</p>
          ) : (
            <>
              <select className={userStyles.input} value={chosenTag?.id ?? ''} onChange={(e) => setTagId(e.target.value)} aria-label="Protected data">
                {askable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className={s.seg} role="radiogroup" aria-label="How much">
                {(
                  [
                    ['full', 'Exact values'],
                    ['aggregate', 'Totals only'],
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={level === v} className={cn(s.segBtn, level === v && s.segBtnActive)} onClick={() => setLevel(v)}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void find();
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input className={cn(userStyles.input, '!pl-9')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a table by name" aria-label="Find a table" />
              </div>
              <button type="submit" className={userStyles.secondaryButton}>
                Find
              </button>
            </form>
            {path ? (
              <p className="text-caption">
                Asking for <code>{path}</code>
              </p>
            ) : null}
            {matches ? (
              <ul className="compact-scroll max-h-44 divide-y divide-[var(--estate-border)] rounded-[8px] border border-[var(--estate-border)]">
                {matches.length === 0 ? <li className="px-3 py-2 text-caption text-muted-foreground">No tables match.</li> : null}
                {matches.map((m) => (
                  <li key={m.path}>
                    <button type="button" className={cn('w-full px-3 py-1.5 text-left text-caption hover:bg-[var(--surface-2)]', path === m.path && 'bg-[var(--brand-a-soft)]')} onClick={() => setPath(m.path)}>
                      {m.path}
                      {m.match === 'meaning' ? <span className="text-muted-foreground"> · similar meaning</span> : null}
                      {m.description ? <span className="block text-muted-foreground">{m.description}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={s.seg} role="radiogroup" aria-label="How much">
              {(
                [
                  ['query', 'Use'],
                  ['export', 'Use + export'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={level === v} className={cn(s.segBtn, level === v && s.segBtnActive)} onClick={() => setLevel(v)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-muted-foreground">For</span>
          <div className={s.seg} role="radiogroup" aria-label="How long">
            {(['7', '30', '90', 'none'] as const)
              .filter((d) => !(d === 'none' && twoApprovals))
              .map((d) => (
                <button key={d} type="button" role="radio" aria-checked={days === d} className={cn(s.segBtn, days === d && s.segBtnActive)} onClick={() => setDays(d)}>
                  {d === 'none' ? 'No end date' : `${d} days`}
                </button>
              ))}
          </div>
        </div>
        <textarea
          className={cn(userStyles.input, 'min-h-[72px] py-2')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why do you need it? (at least 20 characters)"
          aria-label="Why do you need it"
        />
        <Input className={userStyles.input} value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Ticket or case reference (optional)" aria-label="Ticket reference" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={cn(userStyles.primary, 'inline-flex items-center gap-1.5')} disabled={busy} onClick={() => void submit()}>
            <Send className="h-4 w-4" aria-hidden="true" />
            {busy ? 'Sending…' : 'Send request'}
          </button>
          {msg ? (
            <span className={cn('text-caption', msg.ok ? 'text-[var(--ok)]' : 'text-[var(--bad)]')} role="status">
              {msg.text}
            </span>
          ) : null}
        </div>
        <p className="text-caption text-muted-foreground">It goes to the people who approve this data. You can't pick the approver.</p>
      </div>
    </section>
  );
}
