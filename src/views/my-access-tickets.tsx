'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox, KeyRound } from 'lucide-react';
import Link from '@/lib/navigation/link';
import { cn } from '@/lib/utils';
import { useSearchParams } from '@/lib/navigation';
import { useSession } from 'next-auth/react';
import userStyles from '@/components/users/users.module.css';
import { accessFetch, runAsync, send } from '@/components/access/console/api';
import { RequestList, type AccessRequestRow } from '@/components/access/requests/RequestList';
import s from '@/components/access/console/console.module.css';

type Notice = { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: string; read: boolean };

/** Support-style list of access tickets: thread history and follow-up with approvers. */
export default function MyAccessTicketsPage() {
  const params = useSearchParams();
  const openId = params.get('open');
  const { data: session } = useSession();
  const [requests, setRequests] = useState<AccessRequestRow[] | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, n] = await Promise.all([
      accessFetch<{ requests: AccessRequestRow[] }>('/api/access/requests?view=mine'),
      accessFetch<{ notifications: Notice[] }>('/api/access/notifications'),
    ]);
    setRequests(r.requests);
    setNotices(n.notifications);
  }, []);

  useEffect(() => {
    runAsync(() => load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load tickets')));
  }, [load]);

  const meId = (session?.user as { id?: string } | undefined)?.id ?? '';
  const unread = notices.filter((x) => !x.read);

  return (
    <div className={cn(userStyles.surface, userStyles.page)}>
      <div className={cn(userStyles.content, 'flex flex-col gap-5')}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-eyebrow uppercase text-muted-foreground">
              <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
              Support
            </div>
            <h1 className="text-title-section">My access tickets</h1>
            <p className="mt-1 max-w-xl text-caption text-muted-foreground">
              Tickets you raised for data access. Open one to see the conversation and add more information while it is waiting.
            </p>
          </div>
          <Link href="/my-access" className={cn(userStyles.secondaryButton, 'inline-flex items-center gap-1.5 no-underline')}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Ask for access
          </Link>
        </header>

        {error ? <p className={s.errorText} role="alert">{error}</p> : null}

        {unread.length ? (
          <section className={s.card} aria-label="Updates on your tickets">
            <div className={s.cardHead}>
              <h2 className={s.cardTitle}>Updates ({unread.length})</h2>
              <button type="button" className={s.linkBtn} onClick={() => void send('/api/access/notifications', 'POST', { all: true }).then(() => setNotices((cur) => cur.map((x) => ({ ...x, read: true }))))}>
                Mark all read
              </button>
            </div>
            <ul className={cn(s.cardBody, 'flex flex-col gap-1 text-caption')}>
              {unread.map((x) => (
                <li key={x.id}>
                  <span className="font-medium">{x.title}</span>
                  {x.body ? <span className="text-muted-foreground"> — {x.body}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={cn(s.card, 'overflow-hidden')} aria-label="My access tickets">
          {requests === null ? (
            <p className="p-4 text-caption text-muted-foreground">Loading…</p>
          ) : (
            <RequestList
              requests={requests}
              meId={meId}
              empty="No tickets yet. Request access from Ask Data or My data access."
              onChanged={load}
              initialOpenId={openId}
            />
          )}
        </section>
      </div>
    </div>
  );
}
