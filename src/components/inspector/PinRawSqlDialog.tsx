'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createId } from '@paralleldrive/cuid2';
import { X, Pin, LayoutDashboard, Plus } from 'lucide-react';
import type { WidgetSpec } from '@/lib/dashboards/types';
import {
  buildRawSqlWidgetSpec,
  rawKindToWidgetKind,
  type RawSqlChartDsl,
} from '@/lib/dashboards/raw-sql-chart';
import { RawSqlBadge } from './RawSqlBadge';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const GOLD = '#FDB515';
const NEW_DASHBOARD = '__new__';

const WIDGET_SIZE: Record<string, { w: number; h: number }> = {
  kpi: { w: 3, h: 2 }, bar: { w: 6, h: 4 }, line: { w: 6, h: 4 },
  donut: { w: 4, h: 4 }, scatter: { w: 6, h: 4 }, heatmap: { w: 6, h: 4 }, histogram: { w: 6, h: 4 },
};

/** Everything needed to save + pin a raw-SQL chart. */
export interface RawChartPinInput {
  name: string;
  rawSql: string;
  resultSchema: { name: string; type: string }[];
  dsl: RawSqlChartDsl;
  nlIntent?: string;
  /** If already saved via "Save chart", its row (carries id + resolved connection_id). */
  saved?: { id: string; connection_id: string } | null;
}

interface EditableDashboard {
  id: string;
  name: string;
  model_id: string | null;
  my_role: string | null;
}

interface PinRawSqlDialogProps {
  chart: RawChartPinInput;
  /** Called with the saved chart row once it exists (so the card marks it saved). */
  onSaved?: (row: { id: string; connection_id: string }) => void;
  onClose: () => void;
}

/**
 * Phase 3.5C — pin a raw-SQL escape-hatch chart to a dashboard. Unlike the
 * semantic PinToDashboardDialog, a raw-SQL chart is model-agnostic: it is NOT
 * filtered to dashboards sharing a model — it can pin to ANY dashboard the user
 * can edit and carries its own connection. enforceReadOnly re-runs server-side
 * at save (POST /charts) and again at pin (the version-save route).
 */
export function PinRawSqlDialog({ chart, onSaved, onClose }: PinRawSqlDialogProps) {
  const router = useRouter();

  const [widgetName, setWidgetName] = useState(chart.name);
  const [dashboards, setDashboards] = useState<EditableDashboard[]>([]);
  const [dashLoading, setDashLoading] = useState(true);
  const [destination, setDestination] = useState<string>(NEW_DASHBOARD);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load ALL dashboards the user can edit — NO model filter (raw SQL is model-agnostic).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/inspector/dashboards?filter=all')
      .then((r) => (r.ok ? r.json() as Promise<{ dashboards: EditableDashboard[] }> : Promise.reject(new Error(`${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        const editable = (data.dashboards ?? []).filter(
          (d) => d.my_role === 'owner' || d.my_role === 'editor',
        );
        setDashboards(editable);
        setDestination(editable.length > 0 ? editable[0].id : NEW_DASHBOARD);
      })
      .catch(() => { if (!cancelled) setDashboards([]); })
      .finally(() => { if (!cancelled) setDashLoading(false); });
    return () => { cancelled = true; };
  }, []);

  /** Ensure the raw-SQL chart is persisted; returns its id + resolved connection. */
  const ensureChart = useCallback(async (): Promise<{ id: string; connection_id: string }> => {
    if (chart.saved) return chart.saved;
    const resp = await fetch('/api/inspector/charts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chartSource: 'raw_sql',
        name: chart.name,
        rawSql: chart.rawSql,
        resultSchema: chart.resultSchema,
        chartDsl: chart.dsl,
        nlIntent: chart.nlIntent,
      }),
    });
    if (!resp.ok) {
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Failed to save chart (${resp.status})`);
    }
    const data = (await resp.json()) as { chart: { id: string; connection_id: string } };
    const row = { id: data.chart.id, connection_id: data.chart.connection_id };
    onSaved?.(row);
    return row;
  }, [chart, onSaved]);

  const loadCurrentWidgets = useCallback(async (dashboardId: string): Promise<WidgetSpec[]> => {
    const resp = await fetch(`/api/inspector/dashboards/${dashboardId}`);
    if (!resp.ok) throw new Error(`Failed to load dashboard (${resp.status})`);
    const data = (await resp.json()) as { currentVersion?: { widgets?: WidgetSpec[] } };
    return (data.currentVersion?.widgets as WidgetSpec[]) ?? [];
  }, []);

  const saveVersion = useCallback(
    async (dashboardId: string, saved: { id: string; connection_id: string }): Promise<void> => {
      const buildWidget = (existing: WidgetSpec[]): WidgetSpec => {
        const kind = rawKindToWidgetKind(chart.dsl.kind);
        const size = WIDGET_SIZE[kind] ?? { w: 6, h: 4 };
        const row = existing.reduce((max, w) => Math.max(max, w.position.row + w.position.h), 0);
        return buildRawSqlWidgetSpec({
          widgetId: createId(),
          title: widgetName.trim() || chart.name,
          rawSql: chart.rawSql,
          resultSchema: chart.resultSchema,
          connectionId: saved.connection_id,
          dsl: chart.dsl,
          position: { col: 0, row, w: size.w, h: size.h },
          sourceChartId: saved.id,
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
            changeSummary: `Pinned raw-SQL chart "${widgetName.trim() || chart.name}" from Inspector`,
          }),
        });
      };

      let resp = await attempt();
      if (resp.status === 409) resp = await attempt();
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string; details?: string[] };
        const detail = Array.isArray(data.details) ? data.details.join('; ') : data.error;
        throw new Error(detail ?? `Failed to save widget (${resp.status})`);
      }
    },
    [chart, widgetName, loadCurrentWidgets],
  );

  const handleConfirm = useCallback(async () => {
    if (submitting) return;
    // A raw-SQL chart is model-agnostic and cannot seed a new dashboard's
    // model_id — it pins into an EXISTING dashboard the user can edit.
    if (destination === NEW_DASHBOARD) {
      setError('Pick an existing dashboard to pin into.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved = await ensureChart();
      await saveVersion(destination, saved);
      router.push(`/inspector/dashboards/${destination}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pin failed');
      setSubmitting(false);
    }
  }, [submitting, destination, ensureChart, saveVersion, router]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid rgba(253,181,21,0.12)' }}>
          <Pin size={13} style={{ color: GOLD }} />
          <span style={{ ...MONO, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: GOLD, flex: 1 }}>
            PIN RAW-SQL CHART
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wb-muted)', display: 'flex' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <RawSqlBadge />

          <Field label="WIDGET NAME">
            <input type="text" value={widgetName} onChange={(e) => setWidgetName(e.target.value)} placeholder="Widget name" style={inputStyle} />
          </Field>

          <Field label="DESTINATION">
            {dashLoading ? (
              <span style={{ ...MONO, fontSize: 10, color: 'var(--wb-muted)' }}>Loading dashboards…</span>
            ) : dashboards.length === 0 ? (
              <span style={{ ...MONO, fontSize: 10, color: 'var(--wb-muted)' }}>
                No editable dashboards. Create one first, then pin here.
              </span>
            ) : (
              <select value={destination} onChange={(e) => setDestination(e.target.value)} style={inputStyle}>
                {dashboards.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </Field>

          {error && <p style={{ ...MONO, fontSize: 10, color: '#F87171', margin: 0 }}>{error}</p>}

          <button
            onClick={handleConfirm}
            disabled={submitting || dashLoading || dashboards.length === 0}
            style={{
              ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: GOLD, color: '#0D1B2A', border: 'none', borderRadius: 4,
              padding: '8px 14px', cursor: (submitting || dashLoading || dashboards.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (submitting || dashLoading || dashboards.length === 0) ? 0.6 : 1, fontWeight: 600,
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
