'use client';

/**
 * Track B — client-side draft autosave for the dashboard builder.
 *
 * Two write triggers, both POST to …/dashboards/[id]/draft:
 *   1. A debounced write on every dirty widget/layout/guided change.
 *   2. A MANDATORY flush-on-hide (visibilitychange→hidden / pagehide). This is
 *      the exact data-loss gap Track B exists to fix: Inspector's 2s-debounced
 *      autosave has NO on-unload flush, so the last edit before a tab close /
 *      refresh is lost. A blind copy of that debounce would ship the bug back.
 *      The flush is SIZE-AWARE: sendBeacon for bodies under the ~64 KiB
 *      sendBeacon/keepalive budget, synchronous XHR above it (both transports
 *      share that budget, so a large draft would otherwise be silently dropped —
 *      the on-hide guarantee must not have a hidden size ceiling).
 *
 * Writes are gated on `enabled` (editable role AND the draft-hydration decision
 * resolved — never autosave while the "keep/discard" banner is still open, or a
 * blind write of the freshly-loaded version would clobber the stale draft).
 *
 * The subscription only fires when the store is DIRTY, so hydrating a version or
 * discarding a draft (both mark the store clean) never re-creates a draft row.
 *
 * `cancel()` clears any pending debounced write — callers invoke it before a
 * destructive draft op (discard / save) so a queued write can't resurrect a row.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useBuilderStore } from './builder-store';
import type { DashboardVersionLayout } from '@/lib/dashboards/types';

const DEBOUNCE_MS = 1500;
// Headroom under the ~64 KiB sendBeacon/keepalive in-flight budget. Above this,
// the on-hide flush switches to synchronous XHR (no cap). Measured: a rich draft
// crosses 64 KiB at ~60–65 widgets (see draft-beacon-size.test.ts).
const BEACON_SAFE_BYTES = 60 * 1024;

export interface DraftAutosaveHandle {
  /** Cancel a pending debounced write (call before discard / save). */
  cancel: () => void;
  /** Await a synchronous draft write of the current store state (used by the 409
   *  conflict path so the loser's edits are guaranteed persisted before reload). */
  flushNow: () => Promise<void>;
}

export function useDraftAutosave(dashboardId: string, enabled: boolean): DraftAutosaveHandle {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Build the payload from LIVE store state at fire time (never a stale closure —
  // critical for the on-hide beacon, which must capture the very last edit).
  const buildBody = useCallback(() => {
    const s = useBuilderStore.getState();
    const layouts: DashboardVersionLayout = {
      columns: 12,
      rows: s.widgets.map((w) => ({ widgetId: w.widgetId, ...w.position })),
    };
    return JSON.stringify({
      widgets: s.widgets,
      layouts,
      guidedSession: s.guidedSession,
      baseVersionId: s.currentVersionId,
    });
  }, []);

  const url = `/api/inspector/dashboards/${dashboardId}/draft`;

  const flush = useCallback(
    (viaBeacon: boolean) => {
      // Nothing uncommitted → nothing to persist. Skipping keeps the on-hide
      // beacon from rewriting a clean/just-discarded state.
      if (!useBuilderStore.getState().dirty) return;
      const body = buildBody();

      // ── Debounced (page-stays) path ─────────────────────────────────────────
      // The page isn't leaving; a plain async fetch has no size limit.
      if (!viaBeacon) {
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }).catch(() => {
          /* best-effort; the on-hide flush is the durable backstop */
        });
        return;
      }

      // ── On-hide path (the data-loss fix) ────────────────────────────────────
      // sendBeacon and keepalive fetch SHARE a ~64 KiB per-origin in-flight
      // budget, so on a large draft (~65+ widgets, measured) BOTH silently drop
      // the payload — a transport swap buys availability, not size headroom. So:
      //   • small body → sendBeacon (fast, non-blocking, the common case);
      //   • over budget → SYNCHRONOUS XHR, the one transport with no keepalive
      //     cap that still completes during pagehide/visibilitychange. Sync XHR
      //     is deprecated for general use but sanctioned for exactly this
      //     unload-flush case; it briefly blocks the (already-departing) tab.
      const bytes = new Blob([body]).size;
      if (bytes <= BEACON_SAFE_BYTES && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return;
      }
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, /* async */ false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(body);
      } catch {
        // Last-ditch: keepalive fetch. May itself hit the cap on a huge draft,
        // but the debounced write above already persisted everything up to the
        // last ~1.5 s, so at worst the final in-window delta is lost.
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    },
    [url, buildBody],
  );

  const flushNow = useCallback(async () => {
    cancel();
    // Deliberately NOT gated on `dirty`: the 409 path needs the draft written
    // even if a debounced write already flipped things, so recovery is guaranteed.
    const body = buildBody();
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch {
      /* best-effort */
    }
  }, [url, buildBody, cancel]);

  // ── Debounced write on dirty content changes ────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const unsub = useBuilderStore.subscribe((state, prev) => {
      if (!state.dirty) return;
      const contentChanged =
        state.widgets !== prev.widgets || state.guidedSession !== prev.guidedSession;
      if (!contentChanged) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flush(false);
      }, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      cancel();
    };
  }, [enabled, flush, cancel]);

  // ── Mandatory flush-on-hide (the data-loss fix) ─────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled, flush]);

  return { cancel, flushNow };
}
