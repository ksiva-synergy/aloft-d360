'use client';

/** Shared bits for the semantic-model pages (Entities, Lineage). */

import React from 'react';
import { cn } from '@/lib/utils';

export const isApproved = (status: string) => status === 'governed';

/** Approved = solid green dot; Draft = dashed amber ring. */
export function ApprovalPill({ status, className }: { status: string; className?: string }) {
  const ok = isApproved(status);
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-caption',
        ok
          ? 'border-transparent bg-[var(--ok-bg)] text-[var(--ok)]'
          : 'border-dashed border-[color-mix(in_srgb,var(--warn)_55%,transparent)] text-[var(--warn)]',
        className,
      )}
      title={ok ? 'Approved definition' : 'Draft: runs, but numbers are unverified until approved'}
    >
      <ApprovalDot status={status} />
      {ok ? 'Approved' : 'Draft'}
    </span>
  );
}

export function ApprovalDot({ status }: { status: string }) {
  return isApproved(status)
    ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--ok)]" />
    : <span aria-hidden className="size-1.5 shrink-0 rounded-full border border-dashed border-[var(--warn)]" />;
}

/** `catalog.schema.table` + optional `.column`, with the column emphasised. */
export function FieldRef({ fullPath, column, expression }: { fullPath: string; column?: string | null; expression?: string | null }) {
  return (
    <span className="min-w-0 truncate font-mono text-ui-regular" title={`${fullPath}${column ? `.${column}` : ''}${expression ? ` \u00b7 ${expression}` : ''}`}>
      {column ? (
        <>
          <span className="text-[var(--estate-text-dim)]">{fullPath.split('.').pop()}.</span>
          <span className="text-[var(--estate-ink)]">{column}</span>
        </>
      ) : expression ? (
        <span className="text-[var(--estate-ink)]">{expression}</span>
      ) : (
        <span className="text-[var(--estate-text-dim)]">{fullPath}</span>
      )}
    </span>
  );
}