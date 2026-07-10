'use client';

import { useEffect, useRef, useState } from 'react';

const REFRESH_KINDS = ['estate_inventory', 't0_structural'] as const;
// All job kinds monitored for active-poll detection (T1/T2 keep fast-poll active during a sequential run)
const ACTIVE_KINDS = ['estate_inventory', 't0_structural', 't1_profile', 't2_semantic'] as const;

// If a job finished within this window on first mount, trigger an immediate refresh
// so users landing on the page after a job completes see fresh data right away.
const BOOTSTRAP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

interface JobKindSummary {
  kind: string;
  running: number;
  queued: number;
  last_finished_at: string | null;
}

/**
 * Polls job summaries and bumps refreshKey when inventory/scan jobs finish
 * or while they are actively running (fast poll).
 *
 * Also triggers an immediate refresh on first mount if a relevant job completed
 * within the last 2 minutes — handles the case where the user navigates to the
 * page after a job already finished between polls.
 */
export function useCatalogRefresh(): number {
  const [refreshKey, setRefreshKey] = useState(0);
  const lastFinishedRef = useRef<Record<string, string | null>>({});

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const schedule = (ms: number) => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => { void poll(); }, ms);
    };

    const poll = async () => {
      if (cancelled) return;

      try {
        const res = await fetch('/api/agent-lab/context/jobs/summary');
        if (!res.ok) return;

        const json = await res.json();
        const summaries: JobKindSummary[] = json.data ?? [];

        let shouldRefresh = false;
        let hasActive = false;

        // Check ALL job kinds for active status (keeps fast-poll alive during T1/T2)
        for (const kind of ACTIVE_KINDS) {
          const row = summaries.find((s) => s.kind === kind);
          if (row && (row.running > 0 || row.queued > 0)) hasActive = true;
        }

        // Only bump refreshKey for inventory/scan completions (T1/T2 don't change the table lists)
        for (const kind of REFRESH_KINDS) {
          const row = summaries.find((s) => s.kind === kind);
          if (!row) continue;

          const ts = row.last_finished_at ?? null;
          const prev = lastFinishedRef.current[kind];

          if (prev !== undefined && ts !== null && ts !== prev) {
            // Timestamp changed since last poll — job just finished
            shouldRefresh = true;
          } else if (prev === undefined && ts !== null) {
            // First observation on mount — refresh if the job finished recently
            const age = Date.now() - new Date(ts).getTime();
            if (age < BOOTSTRAP_WINDOW_MS) {
              shouldRefresh = true;
            }
          }

          lastFinishedRef.current[kind] = ts;
        }

        if (shouldRefresh) {
          setRefreshKey((k) => k + 1);
        }

        schedule(hasActive ? 5_000 : 15_000);
      } catch {
        schedule(15_000);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    };

    void poll();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return refreshKey;
}
