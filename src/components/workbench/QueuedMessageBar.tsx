'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, Pencil, X } from 'lucide-react';

/**
 * The follow-up the person typed while a reply was streaming (see useQueuedSend). It sends by
 * itself when the reply finishes; "Send now" stops the reply and sends it immediately.
 */
export function QueuedMessageBar({
  text,
  onSendNow,
  onEdit,
  onDiscard,
  maxWidth,
}: {
  text: string | null;
  onSendNow: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  maxWidth?: number;
}) {
  return (
    <AnimatePresence initial={false}>
      {text && (
        <motion.div
          key="queued"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          role="status"
          aria-live="polite"
          className="mx-auto mb-2 flex w-full items-center gap-2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] py-1.5 pl-3 pr-1.5"
          style={{ maxWidth }}
        >
          <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[length:var(--type-caption-size)] text-[var(--ink-3)]">
              Queued · sends when this reply finishes
            </p>
            <p className="truncate text-size-ui text-[var(--ink-1)]" title={text}>{text}</p>
          </div>
          <button
            type="button"
            onClick={onSendNow}
            title="Stop the current reply and send this now (Ctrl+Enter)"
            className="inline-flex h-7 shrink-0 items-center rounded-full bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] px-3 text-size-ui font-medium text-[var(--brand-a-ink)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--brand-a)_20%,transparent)] active:scale-[0.97] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            Send now
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit queued message"
            title="Edit"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--ink-2)] transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDiscard}
            aria-label="Remove queued message"
            title="Remove"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--ink-2)] transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
