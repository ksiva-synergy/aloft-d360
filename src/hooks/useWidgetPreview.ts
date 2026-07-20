'use client';

import { useState, useEffect, useCallback } from 'react';
import type { WidgetDataResult, WidgetSpec } from '@/lib/dashboards/types';

/**
 * src/hooks/useWidgetPreview.ts
 *
 * Fetches the PER-WIDGET authoring-preview route for the guided drill-in:
 *
 *     GET /api/inspector/dashboards/[dashboardId]/widgets/[widgetId]/data
 *
 * ── THE CONTRACT (why this is not `useDashboardData`) ────────────────────────
 * There are two data routes, deliberately:
 *   - the BATCH route `[dashboardId]/data` (see useDashboardData) is
 *     governed-only for everyone — the shared DashboardViewer uses it so it can
 *     NEVER render another user's candidate/draft data;
 *   - THIS per-widget route hands the OWNER-SCOPED authoring bypass (an owner
 *     previewing their own not-yet-governed model gets live rows + isDraft),
 *     guarded per-definition by the owner-boundary 403 in buildWidgetPreview.
 *
 * The drill-in MUST fetch the per-widget route, never the batch route. Pointing
 * this at `[dashboardId]/data` "because the shell grounded against it for shape"
 * re-opens the exact draft-leak the owner-boundary test was built to prevent —
 * and that test would NOT catch it, because it guards the per-widget route, not
 * this hook's choice of URL. The split is regression-proofed by the drill-in
 * data-contract test (asserts this URL, forbids the batch URL). This hook is the
 * one place the per-widget URL is constructed; do not reuse useDashboardData
 * here even though its result shape is compatible.
 *
 * Unlike the batch hook, this returns ONE `WidgetDataResult` (the per-widget
 * route responds with the result directly, not a `{ widgets: {...} }` map).
 *
 * ── TWO MODES on the SAME URL (Phase 5) ──────────────────────────────────────
 * The guided drill-in authors brand-new widgets that have NOT been saved yet, so
 * the version-backed GET (which resolves the widget from a saved version) would
 * 404 — a confirmed-but-unsaved chart showing an error where its preview belongs.
 * When an `ephemeralWidget` spec is supplied, this hook POSTs that in-progress
 * spec to the SAME per-widget URL (the ephemeral authoring-preview; executes and
 * returns, persists nothing). Absent a spec it falls back to the version-backed
 * GET (a saved widget, or the graceful degrade if a confirmed widget has no live
 * spec in the store). EITHER WAY the URL is the per-widget route — the drill-in's
 * route contract (never the governed-only batch route) holds for both methods.
 */

export interface UseWidgetPreviewReturn {
  /** The per-widget result. Null before the first successful fetch / when no
   *  widgetId is being previewed (an unconfirmed item has nothing to fetch). */
  result: WidgetDataResult | null;
  /** True while a fetch is in flight. */
  loading: boolean;
  /**
   * Transport / HTTP-level failure — a network error or a non-200 (401/403/404
   * carrying `{ error }`). Distinct from a typed `status: 'error'` result, which
   * is a 200 the caller maps into an inspectable error render state. Both must
   * surface, never a silent blank.
   */
  error: string | null;
  /** Re-run the same per-widget fetch (NL-refine re-run / retry). */
  refetch: () => void;
}

export function useWidgetPreview(
  dashboardId: string,
  widgetId: string | null,
  ephemeralWidget?: WidgetSpec | null,
): UseWidgetPreviewReturn {
  const [result, setResult] = useState<WidgetDataResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable serialization: the in-progress spec is a fresh object each render, so
  // depend on its JSON (not its identity) to avoid a re-fetch loop. Doubles as
  // the POST body.
  const specJson = ephemeralWidget ? JSON.stringify(ephemeralWidget) : null;

  const refetch = useCallback(async () => {
    // No confirmed widget to preview → nothing to fetch. The drill-in renders
    // the not-wired (`awaiting_data`) state in this case.
    if (!dashboardId || !widgetId) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // PER-WIDGET route — see the contract note above. NEVER `${dashboardId}/data`.
      const url = `/api/inspector/dashboards/${dashboardId}/widgets/${widgetId}/data`;
      // With an in-progress spec → POST the ephemeral authoring-preview (nothing
      // persisted). Otherwise → version-backed GET.
      const res = specJson
        ? await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: `{"widget":${specJson}}`,
          })
        : await fetch(url);

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed with status ${res.status}`);
        setResult(null);
        return;
      }

      const json = (await res.json()) as WidgetDataResult;
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error fetching widget preview');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [dashboardId, widgetId, specJson]);

  // Fetch on mount and whenever the previewed widget changes (drill-in cursor
  // moves to another confirmed item).
  useEffect(() => {
    refetch();
  }, [refetch]);

  return { result, loading, error, refetch };
}
