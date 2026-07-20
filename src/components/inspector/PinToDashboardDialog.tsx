'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createId } from '@paralleldrive/cuid2';
import { X, Pin, LayoutDashboard, Plus } from 'lucide-react';
import type { SemanticChartMessage } from '@/hooks/useInspectorChat';
import type { WidgetSpec } from '@/lib/dashboards/types';
import { buildWidgetSpecFromChart } from './dashboard-builder/chart-mapping';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const GOLD = '#FDB515';

const NEW_DASHBOARD = '__new__';

/** Default grid size per widget kind — mirrors builder-store DEFAULT_WIDGET_SIZE. */
const WIDGET_SIZE: Record<string, { w: number; h: number }> = {
  kpi: { w: 3, h: 2 },
  bar: { w: 6, h: 4 },
  line: { w: 6, h: 4 },
  donut: { w: 4, h: 4 },
  scatter: { w: 6, h: 4 },
  heatmap: { w: 6, h: 4 },
  histogram: { w: 6, h: 4 },
};

interface EditableDashboard {
  id: string;
  name: string;
  model_id: string;
  my_role: string | null;
}

interface PinToDashboardDialogProps {
  message: SemanticChartMessage;
  /** platform_charts id if the chart was already saved via "Save to Charts". */
  savedChartId: string | null;
  /** Called with the chart id once it exists (so the card can mark it saved). */
  onChartSaved?: (chartId: string) => void;
  onClose: () => void;
}

/**
 * Phase 2 "Pin to dashboard" — the single action that bridges the Inspector
 * chat and the Dashboard Builder. From a semantic chart in the chat, it:
 *   1. ensures the chart exists in platform_charts (reusing an already-saved id),
 *   2. builds a WidgetSpec (with source_chart_id provenance),
 *   3. appends it to a chosen dashboard's current version (or a new dashboard),
 *   4. saves a new version and navigates to the viewer.
 *
 * Destination dashboards are filtered to those the user can edit AND that share
 * the chart's semantic model — a widget referencing a foreign model is rejected
 * by the version-save cross-model guard, so we never offer an invalid target.
 */
export function PinToDashboardDialog({
  message,
  savedChartId,
  onChartSaved,
  onClose,
}: PinToDashboardDialogProps) {
  const router = useRouter();
  const modelId = message.semanticQuery.modelId;

  const [widgetName, setWidgetName] = useState(message.chartDsl.title);
  const [dashboards, setDashboards] = useState<EditableDashboard[]>([]);
  const [dashLoading, setDashLoading] = useState(true);
  const [destination, setDestination] = useState<string>(NEW_DASHBOARD);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load dashboards the user can edit within this chart's model ──────────────
  useEffect(() => {
    let cancelled = false;
    fetch('/api/inspector/dashboards?filter=all')
      .then((r) => (r.ok ? r.json() as Promise<{ dashboards: EditableDashboard[] }> : Promise.reject(new Error(`${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        const editable = (data.dashboards ?? []).filter(
          (d) => d.model_id === modelId && (d.my_role === 'owner' || d.my_role === 'editor'),
        );
        setDashboards(editable);
        // Prefer an existing dashboard when one is available.
        setDestination(editable.length > 0 ? editable[0].id : NEW_DASHBOARD);
      })
      .catch(() => { if (!cancelled) setDashboards([]); })
      .finally(() => { if (!cancelled) setDashLoading(false); });
    return () => { cancelled = true; };
  }, [modelId]);

  /** Ensure the chart is persisted; return its id (reusing savedChartId). */
  const ensureChart = useCallback(async (): Promise<string> => {
    if (savedChartId) return savedChartId;
    const resp = await fetch('/api/inspector/charts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId,
        name: message.chartDsl.title,
        chartDsl: message.chartDsl,
        semanticQuery: message.semanticQuery,
      }),
    });
    if (!resp.ok) {
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Failed to save chart (${resp.status})`);
    }
    const data = (await resp.json()) as { chart: { id: string } };
    onChartSaved?.(data.chart.id);
    return data.chart.id;
  }, [savedChartId, modelId, message, onChartSaved]);

  /** Load the destination dashboard's current widgets (empty for a new one). */
  const loadCurrentWidgets = useCallback(async (dashboardId: string): Promise<WidgetSpec[]> => {
    const resp = await fetch(`/api/inspector/dashboards/${dashboardId}`);
    if (!resp.ok) throw new Error(`Failed to load dashboard (${resp.status})`);
    const data = (await resp.json()) as { currentVersion?: { widgets?: WidgetSpec[] } };
    return (data.currentVersion?.widgets as WidgetSpec[]) ?? [];
  }, []);

  /** Append the pinned widget and save a new version (single 409 retry). */
  const saveVersion = useCallback(
    async (dashboardId: string, sourceChartId: string): Promise<void> => {
      const buildWidget = (existing: WidgetSpec[]): WidgetSpec => {
        const size = WIDGET_SIZE[message.chartDsl.kind] ?? { w: 6, h: 4 };
        const row = existing.reduce((max, w) => Math.max(max, w.position.row + w.position.h), 0);
        return buildWidgetSpecFromChart({
          widgetId: createId(),
          title: widgetName.trim() || message.chartDsl.title,
          chartDsl: message.chartDsl,
          semanticQuery: message.semanticQuery,
          sourceChartId,
          position: { col: 0, row, w: size.w, h: size.h },
        });
      };

      const attempt = async (): Promise<Response> => {
        const existing = await loadCurrentWidgets(dashboardId);
        const widgets = [...existing, buildWidget(existing)];
        return fetch(`/api/inspector/dashboards/${dashboardId}/versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgets,
            layout: { columns: 12, rows: widgets.map((w) => ({ widgetId: w.widgetId, ...w.position })) },
            changeSummary: `Pinned "${widgetName.trim() || message.chartDsl.title}" from Inspector`,
          }),
        });
      };

      let resp = await attempt();
      if (resp.status === 409) resp = await attempt(); // concurrent version_number race
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string; details?: string[] };
        const detail = Array.isArray(data.details) ? data.details.join('; ') : data.error;
        throw new Error(detail ?? `Failed to save widget (${resp.status})`);
      }
    },
    [loadCurrentWidgets, message, widgetName],
  );

  const handleConfirm = useCallback(async () => {
    if (submitting) return;
    if (destination === NEW_DASHBOARD && !newDashboardName.trim()) {
      setError('Enter a name for the new dashboard');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const chartId = await ensureChart();

      let dashboardId = destination;
      if (destination === NEW_DASHBOARD) {
        // connection_id is resolved server-side from the same tool_catalog entry
        // the Inspector chat uses, so a pin-created dashboard inherits the chat's
        // warehouse — no client-supplied connection needed.
        const resp = await fetch('/api/inspector/dashboards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, name: newDashboardName.trim(), visibility: 'org' }),
        });
        if (!resp.ok) {
          const data = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Failed to create dashboard (${resp.status})`);
        }
        const data = (await resp.json()) as { dashboard: { id: string } };
        dashboardId = data.dashboard.id;
      }

      await saveVersion(dashboardId, chartId);
      router.push(`/inspector/dashboards/${dashboardId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pin failed');
      setSubmitting(false);
    }
  }, [submitting, destination, newDashboardName, ensureChart, saveVersion, modelId, router]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380, maxWidth: '92vw', background: 'var(--wb-canvas, #0D1B2A)',
          border: '1px solid rgba(253,181,21,0.25)', borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid rgba(253,181,21,0.12)' }}>
          <Pin size={13} style={{ color: GOLD }} />
          <span style={{ ...MONO, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: GOLD, flex: 1 }}>
            PIN TO DASHBOARD
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wb-muted)', display: 'flex' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Widget name */}
          <Field label="WIDGET NAME">
            <input
              type="text"
              value={widgetName}
              onChange={(e) => setWidgetName(e.target.value)}
              placeholder="Widget name"
              style={inputStyle}
            />
          </Field>

          {/* Destination */}
          <Field label="DESTINATION">
            {dashLoading ? (
              <span style={{ ...MONO, fontSize: 10, color: 'var(--wb-muted)' }}>Loading dashboards…</span>
            ) : (
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                style={inputStyle}
              >
                {dashboards.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
                <option value={NEW_DASHBOARD}>+ Create new dashboard…</option>
              </select>
            )}
          </Field>

          {/* New dashboard name */}
          {destination === NEW_DASHBOARD && (
            <Field label="NEW DASHBOARD NAME">
              <input
                type="text"
                value={newDashboardName}
                onChange={(e) => setNewDashboardName(e.target.value)}
                placeholder="e.g. Fleet Overview"
                style={inputStyle}
              />
            </Field>
          )}

          {error && (
            <p style={{ ...MONO, fontSize: 10, color: '#F87171', margin: 0 }}>{error}</p>
          )}

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            disabled={submitting || dashLoading}
            style={{
              ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: GOLD, color: '#0D1B2A', border: 'none', borderRadius: 4,
              padding: '8px 14px', cursor: submitting || dashLoading ? 'not-allowed' : 'pointer',
              opacity: submitting || dashLoading ? 0.6 : 1, fontWeight: 600,
            }}
          >
            {destination === NEW_DASHBOARD ? <Plus size={12} /> : <LayoutDashboard size={12} />}
            {submitting ? 'PINNING…' : 'PIN WIDGET'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  ...MONO, fontSize: 11, width: '100%', boxSizing: 'border-box',
  background: 'var(--wb-canvas)', border: '1px solid rgba(253,181,21,0.25)',
  borderRadius: 4, padding: '6px 8px', color: 'var(--wb-text)', outline: 'none',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--wb-muted)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
