'use client';

import React, { useState, useCallback, useEffect } from 'react';

// ── Brand tokens (mirrors InspectorShell / DashboardPane) ─────────────────────
const GOLD   = '#FDB515';
const GREEN  = '#22c55e';
const NAVY   = '#003262';
const MUTED  = '#8892A4';
const BORDER_SUBTLE = 'rgba(253,181,21,0.15)';
const BORDER_MID    = 'rgba(253,181,21,0.25)';
const BORDER_STRONG = 'rgba(253,181,21,0.55)';
const SURFACE       = 'rgba(255,255,255,0.03)';
const SURFACE_HOVER = 'rgba(255,255,255,0.06)';
const GREEN_BG  = 'rgba(34,197,94,0.08)';
const GREEN_BD  = 'rgba(34,197,94,0.30)';
const ARCH_BG   = 'rgba(136,146,164,0.08)';
const ARCH_BD   = 'rgba(136,146,164,0.25)';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const sans: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };

// ── API types ─────────────────────────────────────────────────────────────────

interface ApiDimension {
  id: string;
  column_name: string;
  dimension_label: string;
  dimension_type: string;
  description: string | null;
  synonyms: string[];
  format_hint: string | null;
}

interface ApiMeasure {
  id: string;
  column_name: string | null;
  measure_label: string;
  aggregate: string;
  metric_type: string;
  description: string | null;
  synonyms: string[];
  format_hint: string | null;
  unit: string | null;
  expression: string | null;
}

interface ApiJoin {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  join_type: string;
  join_on_sql: string;
  description: string | null;
}

interface ApiEntity {
  id: string;
  full_path: string;
  entity_label: string;
  description: string | null;
  synonyms: string[];
  status: string;
  dimensions: ApiDimension[];
  measures: ApiMeasure[];
  joins: ApiJoin[];
}

interface ReviewResponse {
  model: { id: string; name: string; status: string };
  entities: ApiEntity[];
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  let bg: string, bd: string, color: string, label: string;
  if (status === 'governed') {
    bg = GREEN_BG; bd = GREEN_BD; color = GREEN; label = 'GOVERNED';
  } else if (status === 'archived') {
    bg = ARCH_BG; bd = ARCH_BD; color = MUTED; label = 'ARCHIVED';
  } else {
    bg = 'rgba(253,181,21,0.08)'; bd = BORDER_MID; color = GOLD; label = 'CANDIDATE';
  }
  return (
    <span style={{
      ...mono, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase',
      background: bg, border: `1px solid ${bd}`, color, borderRadius: 4, padding: '2px 7px',
      flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

// ── Inline editable field ─────────────────────────────────────────────────────

function EditableField({
  label, value, multiline, onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onSave: (val: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, onSave]);

  if (!editing) {
    return (
      <div
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
        style={{
          cursor: 'text', minHeight: 20,
          borderBottom: `1px dashed ${BORDER_SUBTLE}`,
          padding: '2px 0', color: 'var(--wb-ink)',
          ...sans, fontSize: 12,
        }}
      >
        <span style={{ ...mono, fontSize: 9, color: MUTED, marginRight: 6 }}>{label}</span>
        {value || <span style={{ color: MUTED, fontStyle: 'italic' }}>—</span>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ ...mono, fontSize: 9, color: MUTED }}>{label}</span>
      {multiline ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          style={{
            ...sans, fontSize: 12,
            background: SURFACE, border: `1px solid ${BORDER_STRONG}`,
            borderRadius: 4, color: 'var(--wb-ink)', padding: '4px 6px',
            resize: 'vertical', width: '100%',
          }}
        />
      ) : (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          style={{
            ...sans, fontSize: 12,
            background: SURFACE, border: `1px solid ${BORDER_STRONG}`,
            borderRadius: 4, color: 'var(--wb-ink)', padding: '3px 6px',
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            ...mono, fontSize: 9, letterSpacing: '0.06em',
            background: saving ? SURFACE : GOLD, color: saving ? MUTED : NAVY,
            border: 'none', borderRadius: 4, padding: '3px 10px', cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? 'SAVING…' : 'SAVE'}
        </button>
        <button
          onClick={() => setEditing(false)}
          style={{
            ...mono, fontSize: 9, letterSpacing: '0.06em',
            background: 'transparent', color: MUTED,
            border: `1px solid ${BORDER_SUBTLE}`, borderRadius: 4, padding: '3px 10px', cursor: 'pointer',
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}

// ── Entity card ───────────────────────────────────────────────────────────────

function EntityCard({
  entity,
  modelId,
  onPromote,
  onArchive,
  onFieldSaved,
}: {
  entity: ApiEntity;
  modelId: string;
  onPromote: (entityId: string) => Promise<void>;
  onArchive: (entityId: string) => Promise<void>;
  onFieldSaved: (entityId: string, tableKind: string, defId: string, field: string, val: unknown) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<'promote' | 'archive' | null>(null);

  const handlePromote = useCallback(async () => {
    setActing('promote');
    try { await onPromote(entity.id); } finally { setActing(null); }
  }, [entity.id, onPromote]);

  const handleArchive = useCallback(async () => {
    setActing('archive');
    try { await onArchive(entity.id); } finally { setActing(null); }
  }, [entity.id, onArchive]);

  const patchField = useCallback(async (
    tableKind: string, defId: string, field: string, val: unknown,
  ) => {
    const res = await fetch(
      `/api/inspector/semantic/${modelId}/definitions/${defId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableKind, fields: { [field]: val } }),
      },
    );
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      throw new Error(d.error ?? 'Save failed');
    }
    onFieldSaved(entity.id, tableKind, defId, field, val);
  }, [modelId, entity.id, onFieldSaved]);

  const isArchived = entity.status === 'archived';
  const isGoverned = entity.status === 'governed';

  return (
    <div style={{
      background: SURFACE,
      border: `1px solid ${isGoverned ? GREEN_BD : isArchived ? ARCH_BD : BORDER_SUBTLE}`,
      borderRadius: 6,
      marginBottom: 8,
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        cursor: 'pointer',
        background: expanded ? SURFACE_HOVER : 'transparent',
        transition: 'background 0.15s',
      }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{
          ...mono, fontSize: 10, color: MUTED, flexShrink: 0,
          transition: 'transform 0.15s',
          display: 'inline-block',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▶</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            <span style={{ ...sans, fontSize: 13, fontWeight: 600, color: 'var(--wb-ink)' }}>
              {entity.entity_label}
            </span>
            <StatusBadge status={entity.status} />
          </div>
          <div style={{ ...mono, fontSize: 10, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {entity.full_path}
          </div>
        </div>

        <div style={{ ...mono, fontSize: 9, color: MUTED, flexShrink: 0, display: 'flex', gap: 10 }}>
          <span>{entity.dimensions.length}D</span>
          <span>{entity.measures.length}M</span>
          <span>{entity.joins.length}J</span>
        </div>

        {/* Action buttons — stop propagation so they don't toggle expand */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}
          onClick={e => e.stopPropagation()}
        >
          {!isArchived && !isGoverned && (
            <button
              onClick={handlePromote}
              disabled={acting !== null}
              title="Promote to governed"
              style={{
                ...mono, fontSize: 9, letterSpacing: '0.06em',
                background: acting === 'promote' ? SURFACE : GOLD,
                color: acting === 'promote' ? MUTED : NAVY,
                border: 'none', borderRadius: 4, padding: '4px 10px',
                cursor: acting !== null ? 'default' : 'pointer',
              }}
            >
              {acting === 'promote' ? '…' : 'PROMOTE'}
            </button>
          )}
          {!isArchived && (
            <button
              onClick={handleArchive}
              disabled={acting !== null}
              title="Archive"
              style={{
                ...mono, fontSize: 9, letterSpacing: '0.06em',
                background: 'transparent', color: MUTED,
                border: `1px solid ${ARCH_BD}`, borderRadius: 4, padding: '4px 10px',
                cursor: acting !== null ? 'default' : 'pointer',
              }}
            >
              {acting === 'archive' ? '…' : 'ARCHIVE'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '8px 12px 12px', borderTop: `1px solid ${BORDER_SUBTLE}` }}>
          {/* Entity editable fields */}
          <div style={{ marginBottom: 12 }}>
            <EditableField
              label="LABEL"
              value={entity.entity_label}
              onSave={v => patchField('entity', entity.id, 'entity_label', v)}
            />
            <EditableField
              label="DESCRIPTION"
              value={entity.description ?? ''}
              multiline
              onSave={v => patchField('entity', entity.id, 'description', v)}
            />
          </div>

          {/* Dimensions */}
          {entity.dimensions.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...mono, fontSize: 9, letterSpacing: '0.10em', color: GOLD, marginBottom: 6 }}>
                DIMENSIONS ({entity.dimensions.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {entity.dimensions.map(d => (
                  <div key={d.id} style={{ background: SURFACE, border: `1px solid ${BORDER_SUBTLE}`, borderRadius: 4, padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ ...sans, fontSize: 12, fontWeight: 500, color: 'var(--wb-ink)' }}>{d.dimension_label}</span>
                      <span style={{ ...mono, fontSize: 9, color: MUTED }}>{d.dimension_type}</span>
                      <span style={{ ...mono, fontSize: 9, color: MUTED }}>·</span>
                      <span style={{ ...mono, fontSize: 9, color: MUTED }}>{d.column_name}</span>
                    </div>
                    <EditableField label="LABEL" value={d.dimension_label} onSave={v => patchField('dimension', d.id, 'dimension_label', v)} />
                    <EditableField label="DESCRIPTION" value={d.description ?? ''} multiline onSave={v => patchField('dimension', d.id, 'description', v)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Measures */}
          {entity.measures.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...mono, fontSize: 9, letterSpacing: '0.10em', color: GOLD, marginBottom: 6 }}>
                MEASURES ({entity.measures.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {entity.measures.map(m => (
                  <div key={m.id} style={{ background: SURFACE, border: `1px solid ${BORDER_SUBTLE}`, borderRadius: 4, padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' as const }}>
                      <span style={{ ...sans, fontSize: 12, fontWeight: 500, color: 'var(--wb-ink)' }}>{m.measure_label}</span>
                      <span style={{ ...mono, fontSize: 9, color: MUTED }}>{m.aggregate}</span>
                      <span style={{ ...mono, fontSize: 9, color: MUTED }}>·</span>
                      <span style={{ ...mono, fontSize: 9, color: MUTED }}>{m.metric_type}</span>
                      {m.unit && <span style={{ ...mono, fontSize: 9, color: MUTED }}>· {m.unit}</span>}
                    </div>
                    <EditableField label="LABEL" value={m.measure_label} onSave={v => patchField('measure', m.id, 'measure_label', v)} />
                    <EditableField label="DESCRIPTION" value={m.description ?? ''} multiline onSave={v => patchField('measure', m.id, 'description', v)} />
                    <EditableField label="UNIT" value={m.unit ?? ''} onSave={v => patchField('measure', m.id, 'unit', v || null)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Joins */}
          {entity.joins.length > 0 && (
            <div>
              <div style={{ ...mono, fontSize: 9, letterSpacing: '0.10em', color: GOLD, marginBottom: 6 }}>
                JOINS ({entity.joins.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {entity.joins.map(j => (
                  <div key={j.id} style={{ background: SURFACE, border: `1px solid ${BORDER_SUBTLE}`, borderRadius: 4, padding: '5px 8px' }}>
                    <span style={{ ...mono, fontSize: 9, color: MUTED }}>{j.join_type.toUpperCase()}</span>
                    <span style={{ ...mono, fontSize: 9, color: 'var(--wb-ink-dim)', marginLeft: 8 }}>{j.join_on_sql}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SemanticGovernancePanel ───────────────────────────────────────────────────

interface SemanticGovernancePanelProps {
  modelId: string;
}

export function SemanticGovernancePanel({ modelId }: SemanticGovernancePanelProps) {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulkActing, setBulkActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inspector/semantic/${modelId}/review`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as ReviewResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  useEffect(() => { load(); }, [load]);

  const handlePromote = useCallback(async (entityId: string) => {
    const res = await fetch(`/api/inspector/semantic/${modelId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: [entityId] }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      throw new Error(d.error ?? 'Promote failed');
    }
    // Refresh model data
    await load();
  }, [modelId, load]);

  const handleArchive = useCallback(async (entityId: string) => {
    const res = await fetch(`/api/inspector/semantic/${modelId}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: [entityId] }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      throw new Error(d.error ?? 'Archive failed');
    }
    await load();
  }, [modelId, load]);

  const handlePromoteAll = useCallback(async () => {
    if (!data) return;
    const candidateIds = data.entities
      .filter(e => e.status === 'candidate')
      .map(e => e.id);
    if (candidateIds.length === 0) return;
    setBulkActing(true);
    try {
      const res = await fetch(`/api/inspector/semantic/${modelId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityIds: candidateIds }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? 'Bulk promote failed');
      }
      await load();
    } finally {
      setBulkActing(false);
    }
  }, [data, modelId, load]);

  const handleFieldSaved = useCallback((
    _entityId: string, _tableKind: string, _defId: string, _field: string, _val: unknown,
  ) => {
    // Refresh to pick up latest values from server
    load();
  }, [load]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--wb-canvas)' }}>
        <span style={{ ...mono, fontSize: 10, color: MUTED }}>LOADING SEMANTIC MODEL…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--wb-canvas)' }}>
        <span style={{ ...mono, fontSize: 10, color: '#f43f5e' }}>ERROR: {error}</span>
      </div>
    );
  }

  if (!data) return null;

  const candidateCount = data.entities.filter(e => e.status === 'candidate').length;
  const governedCount  = data.entities.filter(e => e.status === 'governed').length;
  const archivedCount  = data.entities.filter(e => e.status === 'archived').length;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--wb-canvas)',
      overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '10px 16px 8px',
        borderBottom: `1px solid ${BORDER_SUBTLE}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ ...sans, fontSize: 13, fontWeight: 600, color: 'var(--wb-ink)' }}>
              {data.model.name}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <span style={{ ...mono, fontSize: 9, color: GOLD }}>{candidateCount} CANDIDATE</span>
              <span style={{ ...mono, fontSize: 9, color: GREEN }}>{governedCount} GOVERNED</span>
              {archivedCount > 0 && <span style={{ ...mono, fontSize: 9, color: MUTED }}>{archivedCount} ARCHIVED</span>}
            </div>
          </div>
          {candidateCount > 0 && (
            <button
              onClick={handlePromoteAll}
              disabled={bulkActing}
              style={{
                ...mono, fontSize: 9, letterSpacing: '0.06em',
                background: bulkActing ? SURFACE : GOLD,
                color: bulkActing ? MUTED : NAVY,
                border: 'none', borderRadius: 4, padding: '5px 12px',
                cursor: bulkActing ? 'default' : 'pointer',
                flexShrink: 0,
              }}
            >
              {bulkActing ? 'PROMOTING…' : `PROMOTE ALL (${candidateCount})`}
            </button>
          )}
        </div>
      </div>

      {/* Entity list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {data.entities.length === 0 ? (
          <div style={{ ...mono, fontSize: 10, color: MUTED, textAlign: 'center', marginTop: 40 }}>
            No entities in this model
          </div>
        ) : (
          data.entities.map(entity => (
            <EntityCard
              key={entity.id}
              entity={entity}
              modelId={modelId}
              onPromote={handlePromote}
              onArchive={handleArchive}
              onFieldSaved={handleFieldSaved}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 16px',
        borderTop: `1px solid ${BORDER_SUBTLE}`,
        flexShrink: 0,
      }}>
        <span style={{ ...mono, fontSize: 9, color: MUTED, letterSpacing: '0.06em' }}>
          SEMANTIC GOVERNANCE · ALOFT v0.4
        </span>
      </div>
    </div>
  );
}

// ── RightPaneTabBar ───────────────────────────────────────────────────────────

export type RightPaneTab = 'results' | 'semantic';

interface RightPaneTabBarProps {
  activeTab: RightPaneTab;
  onChange: (tab: RightPaneTab) => void;
}

export function RightPaneTabBar({ activeTab, onChange }: RightPaneTabBarProps) {
  const tabs: { id: RightPaneTab; label: string }[] = [
    { id: 'results', label: 'RESULTS' },
    { id: 'semantic', label: 'SEMANTIC' },
  ];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      height: 36,
      borderBottom: `1px solid ${BORDER_SUBTLE}`,
      background: 'var(--wb-canvas)',
      flexShrink: 0,
      paddingLeft: 12,
      gap: 0,
    }}>
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              ...mono,
              fontSize: 9,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? `2px solid ${GOLD}` : '2px solid transparent',
              color: isActive ? GOLD : MUTED,
              padding: '0 12px',
              height: '100%',
              cursor: 'pointer',
              transition: 'color 0.1s, border-color 0.1s',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--wb-ink)'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = MUTED; }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
