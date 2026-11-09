'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Lock, Search, Send, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useSearchParams } from '@/lib/navigation';
import { useSession } from 'next-auth/react';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, runAsync, send } from '@/components/access/console/api';
import Link from '@/lib/navigation/link';
import { parseQueryPathsParam } from '@/lib/access/denial-ui';
import { submitPathAccessRequests } from '@/lib/access/access-request-submit';
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
  const initialQueryPaths = useMemo(() => parseQueryPathsParam(params.get('qp')), [params]);
  const compactRequest = params.get('quick') === '1' || initialQueryPaths.length > 0;

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

        <div className={cn('grid grid-cols-1 gap-5', compactRequest ? '' : 'lg:grid-cols-2')}>
          {!compactRequest ? (
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
          ) : null}

          <AskForm
            mine={mine}
            initialTag={params.get('tag')}
            initialPath={params.get('path')}
            initialLabel={params.get('label')}
            initialContext={params.get('context')}
            initialQueryPaths={initialQueryPaths}
            initialLevel={params.get('level') as 'query' | 'export' | null}
            compact={compactRequest}
            onSent={load}
          />
        </div>

        <section className={cn(s.card, 'overflow-hidden')} aria-label="My requests">
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>{compactRequest ? 'Your tickets' : 'My requests'}</h2>
            <Link href="/my-access/tickets" className={s.linkBtn}>
              Open ticket list
            </Link>
          </div>
          {requests === null ? (
            <p className="p-4 text-caption text-muted-foreground">Loading…</p>
          ) : compactRequest ? (
            requests.filter((r) => r.status === 'pending' || r.status === 'info_requested').length === 0 ? (
              <p className="p-4 text-caption text-muted-foreground">No open tickets. After you send a request, follow the conversation here or on the ticket list.</p>
            ) : (
              <RequestList
                requests={requests.filter((r) => r.status === 'pending' || r.status === 'info_requested')}
                meId={meId}
                empty="No open tickets."
                onChanged={load}
              />
            )
          ) : (
            <RequestList requests={requests} meId={meId} empty="You haven't asked for anything yet." onChanged={load} />
          )}
        </section>
      </div>
    </div>
  );
}

function AskForm({
  mine,
  initialTag,
  initialPath,
  initialLabel,
  initialContext,
  initialQueryPaths,
  initialLevel,
  compact,
  onSent,
}: {
  mine: Mine | null;
  initialTag: string | null;
  initialPath: string | null;
  initialLabel: string | null;
  initialContext: string | null;
  initialQueryPaths: string[];
  initialLevel: 'query' | 'export' | null;
  compact?: boolean;
  onSent: () => Promise<void>;
}) {
  const [kind, setKind] = useState<'tag' | 'path'>(initialPath || initialQueryPaths.length ? 'path' : 'tag');
  const [tagId, setTagId] = useState(initialTag ?? '');
  const [path, setPath] = useState(initialPath ?? initialQueryPaths[0] ?? '');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => {
    if (initialQueryPaths.length) return new Set(initialQueryPaths);
    return new Set(initialPath ? [initialPath.toLowerCase()] : []);
  });
  type Suggested = { path: string; label: string; description?: string | null; anchor?: boolean; alreadyHaveUse?: boolean; fromQuery?: boolean };
  const [suggested, setSuggested] = useState<Suggested[]>([]);
  const [suggestFromQuery, setSuggestFromQuery] = useState(false);
  const [expandDiscovery, setExpandDiscovery] = useState(false);
  const [schemaHint, setSchemaHint] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<{ path: string; kind: string; description?: string | null; match?: string }[] | null>(null);
  const [level, setLevel] = useState<'full' | 'aggregate' | 'query' | 'export'>(
    initialLevel === 'export' ? 'export' : initialPath ? 'query' : 'full',
  );
  const [days, setDays] = useState<'7' | '30' | '90' | 'none'>('30');
  const purposeDefault = useMemo(() => {
    const ctx = initialContext?.trim() ?? '';
    if (ctx.length >= 10) return ctx;
    if (initialLabel) return `Use ${initialLabel} for my work`;
    return '';
  }, [initialLabel, initialContext]);
  const [purpose, setPurpose] = useState(purposeDefault);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (purposeDefault && !purpose) setPurpose(purposeDefault);
  }, [purposeDefault, purpose]);
  const [ticket, setTicket] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const askable = (mine?.protections ?? []).filter((p) => p.myLevel !== 'full');
  const chosenTag = askable.find((p) => p.id === tagId) ?? (askable.length && !tagId ? askable[0] : undefined);
  const twoApprovals = kind === 'tag' && !!chosenTag?.twoApprovals;

  useEffect(() => {
    const inspectorTables = initialQueryPaths.length > 0;
    const purposeOk = purpose.trim().length >= 10 || inspectorTables;
    if (kind !== 'path' || !purposeOk) {
      setSuggested([]);
      setSchemaHint(null);
      setSuggestFromQuery(false);
      return;
    }
    const t = setTimeout(() => {
      setSuggesting(true);
      void send<{ tables: Suggested[]; schemaHint: string | null; fromQuery?: boolean }>('/api/access/suggest-targets', 'POST', {
        purpose: purpose.trim() || initialContext?.trim() || 'Use data from my question in Ask Data',
        context: initialContext ?? undefined,
        anchorPath: (initialPath ?? path) || undefined,
        queryPaths: inspectorTables ? initialQueryPaths : undefined,
        expandDiscovery: inspectorTables ? expandDiscovery : true,
      })
        .then((r) => {
          setSuggestFromQuery(!!r.fromQuery);
          setSuggested(r.tables.filter((tab) => !tab.alreadyHaveUse));
          setSchemaHint(r.schemaHint);
          setSelectedPaths((prev) => {
            const next = new Set(prev);
            for (const tab of r.tables) {
              if (tab.anchor || tab.fromQuery) next.add(tab.path);
            }
            return next;
          });
        })
        .catch(() => setSuggested([]))
        .finally(() => setSuggesting(false));
    }, 600);
    return () => clearTimeout(t);
  }, [kind, purpose, initialContext, initialPath, path, initialQueryPaths, expandDiscovery]);

  function togglePath(p: string, on: boolean) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });
    if (on) setPath(p);
  }

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
    const paths = kind === 'path' ? [...selectedPaths] : [];
    if (kind === 'path' && paths.length === 0 && !path) return setMsg({ ok: false, text: 'Pick at least one table.' });
    if (kind === 'path' && paths.length === 0 && path) paths.push(path);
    const agentIdentified = compact && kind === 'path' && (initialQueryPaths.length > 0 || !!initialPath);
    if (!agentIdentified && purpose.trim().length < 10)
      return setMsg({ ok: false, text: 'Say what you need to do with this data (at least 10 characters).' });
    if (reason.trim().length < 20) return setMsg({ ok: false, text: 'Explain why your role needs it (at least 20 characters).' });
    setBusy(true);
    try {
      const bundle = paths.length > 1 ? `bundle-${Date.now()}` : ticket.trim() || null;
      const levelVal =
        kind === 'tag' ? (level === 'aggregate' ? 'aggregate' : 'full') : level === 'export' ? 'export' : 'query';
      const body = {
        targetType: kind,
        tagId: kind === 'tag' ? chosenTag!.id : null,
        level: levelVal,
        durationDays: days === 'none' ? null : Number(days),
        purpose: purpose.trim(),
        reason: reason.trim(),
        ticketRef: bundle,
      };
      const numbers: string[] = [];
      if (kind === 'path') {
        numbers.push(
          ...(await submitPathAccessRequests({
            paths,
            userQuestion: agentIdentified ? initialContext?.trim() || purpose.trim() || undefined : purpose.trim() || undefined,
            reason: reason.trim(),
            level: levelVal === 'export' ? 'export' : 'query',
            durationDays: days === 'none' ? null : Number(days),
            ticketRef: bundle,
          })),
        );
      } else {
        const res = await send<{ request: { number: string } }>('/api/access/requests', 'POST', body);
        numbers.push(res.request.number);
      }
      setMsg({
        ok: true,
        text:
          numbers.length > 1
            ? `Sent ${numbers.length} requests (${numbers.join(', ')}). Approvers see each table separately.`
            : `Sent as ${numbers[0]}. You'll see the answer below.`,
      });
      setPurpose('');
      setReason('');
      setTicket('');
      await onSent();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not send' });
    } finally {
      setBusy(false);
    }
  }

  if (compact && kind === 'path') {
    return (
      <section className={s.card} aria-label="Ask for access">
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>Request access</h2>
        </div>
        <div className={cn(s.cardBody, 'flex max-w-lg flex-col gap-3')}>
          <p className="text-caption font-medium text-foreground">{initialLabel ? `For ${initialLabel}` : 'For your question in Ask Data'}</p>
          <p className="text-caption text-muted-foreground">
            Tables are taken from the agent&apos;s query. You don&apos;t list them here.
          </p>
          <label className="text-caption text-muted-foreground" htmlFor="access-reason-compact">
            Why your role needs it
          </label>
          <textarea
            id="access-reason-compact"
            className={cn(userStyles.input, 'min-h-[72px] py-2')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Business reason for your data owner (at least 20 characters)"
            aria-label="Why your role needs it"
          />
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
          <p className="text-caption text-muted-foreground">Query access · 30 days · sent to data owners.</p>
        </div>
      </section>
    );
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
            {path && (initialLabel || initialContext) ? (
              <div className="rounded-[8px] border border-[var(--estate-border)] bg-[var(--surface-2)] px-3 py-2 text-caption">
                <p className="font-medium text-foreground">
                  From your question: {initialLabel ?? 'this data'}
                </p>
                {initialContext ? <p className="mt-1 text-muted-foreground">{initialContext}</p> : null}
              </div>
            ) : null}
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
            {path || selectedPaths.size ? (
              <p className="text-caption text-muted-foreground">
                {selectedPaths.size > 1
                  ? `${selectedPaths.size} tables selected for this request.`
                  : `Requesting access${initialLabel ? ` to ${initialLabel}` : ' to the selected data'}.`}
              </p>
            ) : null}
            {suggested.length > 0 ? (
              <div className="rounded-[8px] border border-[var(--estate-border)] p-2">
                <p className="mb-2 text-caption font-medium text-foreground">
                  {suggestFromQuery ? 'Tables in the query that Ask Data ran' : `Tables that may match what you described${suggesting ? '…' : ''}`}
                </p>
                <p className="mb-2 text-caption text-muted-foreground">
                  {suggestFromQuery
                    ? 'These are the tables from your SQL, not a name search. Add another only if your work needs more.'
                    : 'The block on one question is often only one table. Tick every table you need for this work.'}
                </p>
                <ul className="flex flex-col gap-1">
                  {suggested.map((tab) => (
                    <li key={tab.path}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-[6px] px-1 py-1 hover:bg-[var(--surface-2)]">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selectedPaths.has(tab.path)}
                          onChange={(e) => togglePath(tab.path, e.target.checked)}
                        />
                        <span className="text-caption">
                          <span className="font-medium">{tab.label}</span>
                          {tab.anchor ? <span className="text-muted-foreground"> · blocked on this</span> : tab.fromQuery ? <span className="text-muted-foreground"> · in your query</span> : null}
                          {tab.description ? <span className="block text-muted-foreground">{tab.description}</span> : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {suggestFromQuery && !expandDiscovery ? (
                  <button type="button" className={cn(s.linkBtn, 'mt-2')} onClick={() => setExpandDiscovery(true)}>
                    Search for other tables
                  </button>
                ) : null}
                {schemaHint ? <p className="mt-2 text-caption text-[var(--warn)]">{schemaHint}</p> : null}
              </div>
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
        <label className="text-caption text-muted-foreground" htmlFor="access-purpose">
          What do you need to do with this data?
        </label>
        <textarea
          id="access-purpose"
          className={cn(userStyles.input, 'min-h-[64px] py-2')}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="e.g. Look up employee SMPL2373 for crew assignment"
          aria-label="What you need to do"
        />
        <label className="text-caption text-muted-foreground" htmlFor="access-reason">
          Why does your role need it?
        </label>
        <textarea
          id="access-reason"
          className={cn(userStyles.input, 'min-h-[72px] py-2')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Business reason for your manager or data owner (at least 20 characters)"
          aria-label="Why your role needs it"
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
