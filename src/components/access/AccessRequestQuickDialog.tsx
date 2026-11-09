'use client';

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import Link from '@/lib/navigation/link';
import userStyles from '@/components/users/users.module.css';
import s from '@/components/access/console/console.module.css';
import { parseAccessRequestHref } from '@/lib/access/denial-ui';
import { submitPathAccessRequests } from '@/lib/access/access-request-submit';

/** Minimal in-chat request (tables already known from Inspector SQL). */
export function AccessRequestQuickDialog({
  open,
  onOpenChange,
  requestHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestHref: string;
}) {
  const prefill = useMemo(() => parseAccessRequestHref(requestHref), [requestHref]);
  const paths = useMemo(() => {
    if (!prefill) return [];
    if (prefill.queryPaths.length) return prefill.queryPaths;
    return prefill.path ? [prefill.path] : [];
  }, [prefill]);
  const userQuestion = useMemo(() => prefill?.context?.trim() ?? '', [prefill]);

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function sendRequest() {
    setMsg(null);
    if (reason.trim().length < 20) {
      setMsg({ ok: false, text: 'Add a short business reason (at least 20 characters).' });
      return;
    }
    if (prefill?.tagId && !prefill.path) {
      setMsg({ ok: false, text: 'Protected-data requests use the full form.' });
      return;
    }
    setBusy(true);
    try {
      const numbers = await submitPathAccessRequests({
        paths,
        userQuestion: userQuestion || undefined,
        reason: reason.trim(),
        level: prefill?.level ?? 'query',
        durationDays: 30,
      });
      setMsg({
        ok: true,
        text: numbers.length > 1 ? `Sent ${numbers.length} tickets (${numbers.join(', ')}).` : `Sent as ${numbers[0]}.`,
      });
      setReason('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not send' });
    } finally {
      setBusy(false);
    }
  }

  const titleLabel = prefill?.label ?? 'your question';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(s.card, 'max-w-md gap-0 border-[var(--estate-border)] p-0')}>
        <DialogHeader className="border-b border-[var(--estate-border)] px-4 py-3">
          <DialogTitle id="access-quick-title" className="text-title-card">
            Request access
          </DialogTitle>
          <p className="text-caption text-muted-foreground">For {titleLabel}</p>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-4 py-3" aria-labelledby="access-quick-title">
          <p className="text-caption text-muted-foreground">
            Tables come from the query the agent already ran. You only add why your role needs access.
          </p>
          <label className="text-caption text-muted-foreground" htmlFor="access-quick-reason">
            Why your role needs it
          </label>
          <textarea
            id="access-quick-reason"
            className={cn(userStyles.input, 'min-h-[72px] py-2 text-caption')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Crew assignment for my fleet this week"
            aria-label="Why your role needs it"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={cn(userStyles.primary, 'text-caption')} disabled={busy} onClick={() => void sendRequest()}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button type="button" className={cn(userStyles.secondaryButton, 'text-caption')} onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            {msg ? (
              <span className={cn('text-caption', msg.ok ? 'text-[var(--ok)]' : 'text-[var(--bad)]')} role="status">
                {msg.text}
              </span>
            ) : null}
          </div>
          <p className="text-caption text-muted-foreground">
            Use for 30 days · query access.{' '}
            <Link href="/my-access/tickets" className={s.linkBtn}>
              My tickets
            </Link>
            {' · '}
            <Link href={requestHref} className={s.linkBtn}>
              More options
            </Link>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
