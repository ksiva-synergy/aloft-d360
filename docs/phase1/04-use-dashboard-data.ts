// ============================================================================
// 04-use-dashboard-data.ts
// Client-side hook for fetching dashboard widget data from the batch
// widget-data route (DATA-1).
//
// Maps to: src/hooks/useDashboardData.ts (NEW file)
//
// Both the viewer (page.tsx) and the builder (when showing real data
// instead of placeholders) consume this hook.
// ============================================================================

"use client";

import { useState, useEffect, useCallback } from "react";

// Mirror the WidgetDataResult type from the route (01-widget-data-route.ts).
// ASSUMPTION: you may want to share this type via a shared types file
// rather than duplicating it. If so, put it in src/lib/dashboards/types.ts
// alongside WidgetSpec.
type WidgetDataResult =
  | {
      status: "ok";
      rows: Record<string, unknown>[];
      sql: string;
      definitionsUsed: { dimensions: string[]; measures: string[] };
      executedAt: string;
    }
  | {
      status: "model_not_governed";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

interface UseDashboardDataReturn {
  /** Map of widgetId → result. Populated as the fetch completes. */
  data: Record<string, WidgetDataResult> | null;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /** Non-null if the entire request failed (network error, 401/403/404). */
  error: string | null;
  /** Re-fetch all widget data. Called on mount and available for retry. */
  refetch: () => void;
  /** Timestamp of the last successful fetch, for "Last updated" display. */
  fetchedAt: string | null;
}

export function useDashboardData(
  dashboardId: string
): UseDashboardDataReturn {
  const [data, setData] = useState<Record<string, WidgetDataResult> | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/inspector/dashboards/${dashboardId}/data`
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message =
          body.error ?? `Request failed with status ${res.status}`;
        setError(message);
        setLoading(false);
        return;
      }

      const json = await res.json();
      // json.widgets is Record<string, WidgetDataResult>
      setData(json.widgets ?? {});
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error fetching data"
      );
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  // Fetch on mount and when dashboardId changes.
  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch, fetchedAt };
}

// ============================================================================
// Usage in the viewer or builder:
//
//   const { data, loading, error, refetch, fetchedAt } = useDashboardData(dashboardId);
//
//   // Per-widget rendering:
//   const widgetResult = data?.[widget.id];
//   if (!widgetResult) return <WidgetSkeleton />;
//   if (widgetResult.status === 'model_not_governed') return <CandidateBanner />;
//   if (widgetResult.status === 'error') return <WidgetError message={widgetResult.message} onRetry={refetch} />;
//   // widgetResult.status === 'ok'
//   return <WidgetPreview widget={widget} resolvedDefs={defs} rows={widgetResult.rows} />;
//
// The trust spine (Phase 3) will also read:
//   widgetResult.sql            — the compiled SQL shown in a collapsible panel
//   widgetResult.definitionsUsed — which governed dims/measures were referenced
//   widgetResult.executedAt     — "Last updated" stamp
//
// ============================================================================

// ============================================================================
// Future considerations (NOT Phase 1):
//
// - Freshness policy: when WidgetSpec.freshness.mode !== 'live', this hook
//   should check a cache before fetching. Phase 2 work.
//
// - Streaming/SSE: if the batch route is upgraded to stream per-widget
//   results as they complete (Phase 2 §2.4 v2), this hook would use
//   EventSource instead of fetch, and setData incrementally per widget.
//   The interface stays the same — callers just see widgets populate faster.
//
// - Cross-filter refetch: when a user clicks a bar in one widget and
//   cross-filtering is wired (Phase 4), this hook needs a way to re-fetch
//   specific widgets with an additional filter applied. Either:
//   (a) refetch() gains a `filters` parameter, or
//   (b) filters are injected at the Zustand store level and this hook
//       reacts to filter changes (preferred — keeps the hook simple).
//
// - Integration with builder-store.ts: if the builder also uses this hook
//   (to show real data in edit mode instead of placeholders), the data
//   should live in the Zustand store's dataCache slice rather than
//   component-local state, so it survives tab switches / panel toggles.
//   Consider refactoring to write into the store from this hook once the
//   builder integration is built.
// ============================================================================
