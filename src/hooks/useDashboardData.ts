'use client';

import { useState, useEffect, useCallback } from 'react';
import type { WidgetDataResult } from '@/lib/dashboards/types';

/**
 * Options for {@link UseDashboardDataReturn.refetch}.
 *  - force: true          → bypass the server result cache for every widget.
 *  - force: '<widgetId>'  → bypass the cache for that widget only (per-widget
 *    "Refresh" button). Live-mode widgets are unaffected either way.
 */
export interface RefetchOptions {
  force?: boolean | string;
}

interface UseDashboardDataReturn {
  /** Map of widgetId → per-widget result. Null until the first fetch resolves. */
  data: Record<string, WidgetDataResult> | null;
  /** True while a fetch is in flight. */
  loading: boolean;
  /** Non-null if the whole request failed (network error, 401/403/404). */
  error: string | null;
  /** Re-fetch all widget data. Runs on mount; also exposed for retry/refresh. */
  refetch: (opts?: RefetchOptions) => void;
  /** Timestamp of the last successful fetch, for the "Last updated" stamp. */
  fetchedAt: string | null;
}

/**
 * Fetches the batch widget-data route (DATA-1) and exposes per-widget results.
 *
 * One request per dashboard, not one per widget — the route returns
 * { widgets: { [widgetId]: WidgetDataResult } }. Consumed by the read-only
 * viewer (and, later, by the builder for live preview).
 */
export function useDashboardData(dashboardId: string): UseDashboardDataReturn {
  const [data, setData] = useState<Record<string, WidgetDataResult> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const refetch = useCallback(async (opts?: RefetchOptions) => {
    setLoading(true);
    setError(null);

    try {
      const force = opts?.force;
      const qs =
        force === true ? '?force=all' : force ? `?force=${encodeURIComponent(force)}` : '';
      const res = await fetch(`/api/inspector/dashboards/${dashboardId}/data${qs}`);

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed with status ${res.status}`);
        return;
      }

      const json = (await res.json()) as { widgets?: Record<string, WidgetDataResult> };
      setData(json.widgets ?? {});
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error fetching data');
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch, fetchedAt };
}
