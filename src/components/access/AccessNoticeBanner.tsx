'use client';

import { useState } from 'react';
import Link from '@/lib/navigation/link';
import { parseAccessRequestHref } from '@/lib/access/denial-ui';
import { AccessRequestQuickDialog } from '@/components/access/AccessRequestQuickDialog';

/** In-chat or results-panel banner when data is restricted (never shows protected values). */
export function AccessNoticeBanner({
  message,
  request,
}: {
  message: string;
  request: string | null;
}) {
  const [open, setOpen] = useState(false);
  const quick = request ? parseAccessRequestHref(request) : null;
  const canQuick = !!(quick && (quick.queryPaths.length > 0 || quick.path) && !quick.tagId);

  return (
    <>
      <div
        role="status"
        className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--warn)]/25 bg-[var(--warn-bg)] px-3 py-2 text-caption text-[var(--warn)]"
      >
        <span className="min-w-0 flex-1 text-[var(--ink-1)]">{message}</span>
        {request ? (
          canQuick ? (
            <button
              type="button"
              className="shrink-0 rounded-[6px] bg-[var(--brand-a)] px-2.5 py-1 text-caption font-semibold text-white hover:opacity-90"
              onClick={() => setOpen(true)}
            >
              Request access
            </button>
          ) : (
            <Link
              href={request}
              className="shrink-0 rounded-[6px] bg-[var(--brand-a)] px-2.5 py-1 text-caption font-semibold text-white no-underline hover:opacity-90"
            >
              Request access
            </Link>
          )
        ) : null}
      </div>
      {canQuick && request ? <AccessRequestQuickDialog open={open} onOpenChange={setOpen} requestHref={request} /> : null}
    </>
  );
}
