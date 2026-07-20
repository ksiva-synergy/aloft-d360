'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Eye, Pencil, Send, Trash2 } from 'lucide-react';
import { DefineMetricPanel, type DefineMetricEdit } from './DefineMetricPanel';
import type { AuthoringScope } from './scope';

// ── Brand tokens (mirror SemanticGovernancePanel) ────────────────────────────
const GOLD = '#FDB515';
const NAVY = '#003262';
const MUTED = '#8892A4';
const RED = '#f43f5e';
const BORDER_SUBTLE = 'rgba(253,181,21,0.15)';
const DRAFT_BG = 'rgba(136,146,164,0.06)';
const DRAFT_BD = 'rgba(136,146,164,0.30)';
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const sans: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };

interface DraftMeasure {
  id: string; column_name: string | null; measure_label: string; aggregate: string;
  metric_type: string; expression: string | null; unit: string | null; format_hint: string | null;
  nl_intent: string | null; status: string;
}
interface DraftDimension {
  id: string; column_name: string; dimension_label: string; dimension_type: string;
  format_hint: string | null; nl_intent: string | null; status: string;
}
interface DraftEntityGroup {
  modelId: string; modelName: string;
  entityId: string; entityLabel: string; dimensions: DraftDimension[]; measures: DraftMeasure[];
}

type PanelState =
  | { mode: 'new'; modelId: string }
  | { mode: 'edit' | 'preview'; edit: DefineMetricEdit; modelId: string }
  | null;

interface MyDraftsSectionProps {
  /** Where drafts come from: one session model, or the whole org (W1). */
  scope: AuthoringScope;
  /**
   * Target model for a NEW draft ("Define a Metric"). In model scope this is the
   * session model; in org scope it's the route's selected authoring model. When
   * absent (org scope with no models yet) the New-Metric button is disabled.
   */
  authorModelId?: string;
}

/**
 * "My Drafts" — the owner-scoped section of the governance panel (Phase 3.5B,
 * deliverable 5). Shows only the current user's draft definitions and makes the
 * lifecycle legible: My Drafts (private) → Candidates (in review) → Governed.
 *
 * Owner-scoping is enforced server-side (created_by === caller, status = draft).
 * The list source depends on `scope`: a single model's /drafts, or the org-wide
 * /my-drafts aggregate. Either way each group carries its own modelId, so
 * submit/delete/edit route to the right per-model handler regardless of scope.
 */
export function MyDraftsSection({ scope, authorModelId }: MyDraftsSectionProps) {
  const [groups, setGroups] = useState<DraftEntityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // definitionId being acted on
  const [panel, setPanel] = useState<PanelState>(null);
  const isOrg = scope.kind === 'org';

  const listUrl = scope.kind === 'model'
    ? `/api/inspector/semantic/${scope.modelId}/drafts`
    : `/api/inspector/semantic/my-drafts`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(listUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { entities: DraftEntityGroup[] };
      setGroups(json.entities ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  }, [listUrl]);

  useEffect(() => { load(); }, [load]);

  const submitDraft = useCallback(async (defModelId: string, id: string, tableKind: 'measure' | 'dimension') => {
    setBusy(id);
    try {
      const res = await fetch(`/api/inspector/semantic/${defModelId}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definitionIds: [id], tableKind }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? 'Submit failed');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setBusy(null);
    }
  }, [load]);

  const deleteDraft = useCallback(async (defModelId: string, id: string, tableKind: 'measure' | 'dimension') => {
    setBusy(id);
    try {
      const res = await fetch(`/api/inspector/semantic/${defModelId}/archive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definitionIds: [id], tableKind }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? 'Delete failed');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  }, [load]);

  const editForMeasure = (g: DraftEntityGroup, m: DraftMeasure): DefineMetricEdit => ({
    tableKind: 'measure', id: m.id, entityId: g.entityId,
    measure_label: m.measure_label, metric_type: m.metric_type, aggregate: m.aggregate,
    column_name: m.column_name, expression: m.expression, unit: m.unit, format_hint: m.format_hint,
    nl_intent: m.nl_intent,
  });
  const editForDimension = (g: DraftEntityGroup, d: DraftDimension): DefineMetricEdit => ({
    tableKind: 'dimension', id: d.id, entityId: g.entityId,
    dimension_label: d.dimension_label, dimension_type: d.dimension_type,
    column_name: d.column_name, format_hint: d.format_hint, nl_intent: d.nl_intent,
  });

  const totalDrafts = groups.reduce((n, g) => n + g.dimensions.length + g.measures.length, 0);

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Section header + New Metric */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ ...mono, fontSize: 10, letterSpacing: '0.10em', color: MUTED }}>MY DRAFTS</span>
          {totalDrafts > 0 && <span style={{ ...mono, fontSize: 9, color: MUTED }}>({totalDrafts})</span>}
        </div>
        <button
          onClick={() => { if (authorModelId) setPanel({ mode: 'new', modelId: authorModelId }); }}
          disabled={!authorModelId}
          title={authorModelId ? 'Define a new metric' : 'No semantic model available to author against yet'}
          style={{
            ...mono, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: authorModelId ? GOLD : 'transparent', color: authorModelId ? NAVY : MUTED,
            border: authorModelId ? 'none' : `1px solid ${DRAFT_BD}`, borderRadius: 4, padding: '5px 11px',
            cursor: authorModelId ? 'pointer' : 'default', fontWeight: 600,
          }}
        >
          <Plus size={12} /> Define a Metric
        </button>
      </div>

      <div style={{ ...mono, fontSize: 9, color: MUTED, marginBottom: 8, fontStyle: 'italic' }}>
        Drafts are private to you until you submit them for governance.
      </div>

      {loading && <div style={{ ...mono, fontSize: 10, color: MUTED }}>LOADING DRAFTS…</div>}
      {error && <div style={{ ...mono, fontSize: 10, color: RED, marginBottom: 6 }}>{error}</div>}

      {!loading && totalDrafts === 0 && (
        <div style={{
          ...mono, fontSize: 10, color: MUTED, textAlign: 'center', padding: '16px 8px',
          border: `1px dashed ${DRAFT_BD}`, borderRadius: 6, lineHeight: 1.6,
        }}>
          No drafts yet. Click <span style={{ color: GOLD }}>Define a Metric</span> to author one.
        </div>
      )}

      {groups.map((g) => (
        <div key={g.entityId} style={{ marginBottom: 8 }}>
          <div style={{ ...mono, fontSize: 9, color: MUTED, marginBottom: 4 }}>
            {g.entityLabel}
            {isOrg && <span style={{ opacity: 0.6 }}> · {g.modelName}</span>}
          </div>
          {g.measures.map((m) => (
            <DraftRow
              key={m.id}
              label={m.measure_label}
              subtitle={m.nl_intent}
              typeTag={m.metric_type}
              busy={busy === m.id}
              onPreview={() => setPanel({ mode: 'preview', edit: editForMeasure(g, m), modelId: g.modelId })}
              onEdit={() => setPanel({ mode: 'edit', edit: editForMeasure(g, m), modelId: g.modelId })}
              onSubmit={() => submitDraft(g.modelId, m.id, 'measure')}
              onDelete={() => deleteDraft(g.modelId, m.id, 'measure')}
            />
          ))}
          {g.dimensions.map((d) => (
            <DraftRow
              key={d.id}
              label={d.dimension_label}
              subtitle={d.nl_intent}
              typeTag={`dim · ${d.dimension_type}`}
              busy={busy === d.id}
              onPreview={() => setPanel({ mode: 'preview', edit: editForDimension(g, d), modelId: g.modelId })}
              onEdit={() => setPanel({ mode: 'edit', edit: editForDimension(g, d), modelId: g.modelId })}
              onSubmit={() => submitDraft(g.modelId, d.id, 'dimension')}
              onDelete={() => deleteDraft(g.modelId, d.id, 'dimension')}
            />
          ))}
        </div>
      ))}

      {panel && (
        <DefineMetricPanel
          modelId={panel.modelId}
          edit={panel.mode === 'new' ? undefined : panel.edit}
          autoPreview={panel.mode === 'preview'}
          onSaved={load}
          onClose={() => { setPanel(null); load(); }}
        />
      )}
    </div>
  );
}

function DraftRow({
  label, subtitle, typeTag, busy, onPreview, onEdit, onSubmit, onDelete,
}: {
  label: string; subtitle: string | null; typeTag: string; busy: boolean;
  onPreview: () => void; onEdit: () => void; onSubmit: () => void; onDelete: () => void;
}) {
  return (
    <div style={{
      background: DRAFT_BG, border: `1px solid ${DRAFT_BD}`, borderRadius: 5,
      padding: '7px 9px', marginBottom: 5, opacity: busy ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: subtitle ? 2 : 0 }}>
        <span style={{
          ...mono, fontSize: 8, letterSpacing: '0.10em', textTransform: 'uppercase',
          background: 'rgba(136,146,164,0.12)', color: MUTED, border: `1px solid ${DRAFT_BD}`,
          borderRadius: 3, padding: '1px 6px', flexShrink: 0,
        }}>
          DRAFT
        </span>
        <span style={{ ...sans, fontSize: 12, fontWeight: 600, color: 'var(--wb-ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span style={{ ...mono, fontSize: 9, color: MUTED, flexShrink: 0 }}>{typeTag}</span>
      </div>
      {subtitle && (
        <div style={{ ...sans, fontSize: 11, color: MUTED, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtitle}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <RowBtn icon={<Eye size={11} />} label="Preview" onClick={onPreview} disabled={busy} />
        <RowBtn icon={<Pencil size={11} />} label="Edit" onClick={onEdit} disabled={busy} />
        <RowBtn icon={<Send size={11} />} label="Submit" onClick={onSubmit} disabled={busy} accent />
        <div style={{ flex: 1 }} />
        <RowBtn icon={<Trash2 size={11} />} label="Delete" onClick={onDelete} disabled={busy} danger />
      </div>
    </div>
  );
}

function RowBtn({
  icon, label, onClick, disabled, accent, danger,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; accent?: boolean; danger?: boolean;
}) {
  const color = danger ? RED : accent ? NAVY : MUTED;
  const bg = accent ? GOLD : 'transparent';
  const border = accent ? GOLD : danger ? 'rgba(244,63,94,0.3)' : BORDER_SUBTLE;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        ...mono, fontSize: 8, letterSpacing: '0.06em', textTransform: 'uppercase',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: bg, color, border: `1px solid ${border}`, borderRadius: 3,
        padding: '3px 8px', cursor: disabled ? 'default' : 'pointer', fontWeight: accent ? 600 : 400,
      }}
    >
      {icon} {label}
    </button>
  );
}
