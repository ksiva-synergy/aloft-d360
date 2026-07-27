'use client';

import React from 'react';
import { X, ChevronRight, Lock, CheckCircle2, Archive, ArrowUpRight, Sparkles, Database } from 'lucide-react';
import { SynonymEditor } from '../authoring/SynonymEditor';
import { useCatalogStore } from './catalog-store';
import type { CatalogRow } from './catalog-types';
import type { RowAction } from './CatalogTable';
import { CatalogLineageGraph, type LineageGraphDTO } from './CatalogLineageGraph';
import {
  MONO, SANS, SERIF, MUTED, INK, INK_DIM, BORDER, GOLD,
  kindLabel, kindColorVar, statusLabel, statusColorVar, tint,
} from './mc-ui';

/**
 * Per-item detail drawer. Row data comes from the store (review/drafts); the
 * lineage graph + compiled-SQL trust view + omissions come from ONE
 * GET /lineage?focus=<nodeId> call. All of that is governed-model-scoped, so on
 * a non-governed model those panels render an honest "unlock when governed" CTA
 * rather than a bare omission.
 */

interface LineageState {
  loading: boolean;
  governed: boolean;
  graph: LineageGraphDTO | null;
  compiledSql: string | null;
  omissions: { field: string; reason: string }[];
  error: string | null;
}

interface Props {
  onRowAction: (action: RowAction, row: CatalogRow) => void;
}

export function DetailDrawer({ onRowAction }: Props) {
  const drawerOpen = useCatalogStore((s) => s.drawerOpen);
  const closeDrawer = useCatalogStore((s) => s.closeDrawer);
  const openDrawer = useCatalogStore((s) => s.openDrawer);
  const rows = useCatalogStore((s) => s.rows);
  const session = useCatalogStore((s) => s.session);
  const activeModelId = useCatalogStore((s) => s.activeModelId);
  const activeModelGoverned = useCatalogStore((s) => s.activeModelGoverned);
  const lens = useCatalogStore((s) => s.lens);

  const row = rows.find((r) => r.rowKey === drawerOpen) ?? null;
  const [focusNodeId, setFocusNodeId] = React.useState<string | null>(null);
  const [lineage, setLineage] = React.useState<LineageState>({ loading: false, governed: false, graph: null, compiledSql: null, omissions: [], error: null });
  const [sqlOpen, setSqlOpen] = React.useState(false);

  // Reset focus to the opened row's node whenever the open row changes.
  React.useEffect(() => {
    if (row) setFocusNodeId(row.nodeId);
  }, [row?.rowKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch lineage for the current focus node.
  React.useEffect(() => {
    if (!row || !focusNodeId) return;
    if (!activeModelGoverned) {
      setLineage({ loading: false, governed: false, graph: null, compiledSql: null, omissions: [], error: null });
      return;
    }
    let cancelled = false;
    setLineage((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/inspector/semantic/lineage?focus=${encodeURIComponent(focusNodeId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: {
        status: string;
        focus?: { nodes: { id: string; kind: string; label: string; status?: string; compiledSql?: string }[]; edges: { from: string; to: string; kind: string; candidate?: boolean }[] };
        omissions?: { field: string; reason: string }[];
      }) => {
        if (cancelled) return;
        if (d.status !== 'ok' || !d.focus) {
          setLineage({ loading: false, governed: false, graph: null, compiledSql: null, omissions: [], error: null });
          return;
        }
        const graph: LineageGraphDTO = {
          nodes: d.focus.nodes.map((n) => ({ id: n.id, kind: n.kind as LineageGraphDTO['nodes'][number]['kind'], label: n.label, status: n.status })),
          edges: d.focus.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind as LineageGraphDTO['edges'][number]['kind'], candidate: e.candidate })),
        };
        const focusNode = d.focus.nodes.find((n) => n.id === focusNodeId);
        setLineage({ loading: false, governed: true, graph, compiledSql: focusNode?.compiledSql ?? null, omissions: d.omissions ?? [], error: null });
      })
      .catch((e: unknown) => { if (!cancelled) setLineage({ loading: false, governed: true, graph: null, compiledSql: null, omissions: [], error: e instanceof Error ? e.message : 'Failed to load lineage' }); });
    return () => { cancelled = true; };
  }, [row?.rowKey, focusNodeId, activeModelGoverned]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null;

  const me = session?.currentUserId ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const canAct = isAdmin || (!!me && row.createdBy === me);
  const kindC = kindColorVar(row.kind);
  const statusC = statusColorVar(row.status);

  // Sibling dimensions of this row's entity (for the Dimensions section).
  const entityDims = rows.filter((r) => r.kind === 'dimension' && r.entityId === row.entityId);

  // When a lineage node is clicked, refocus the drawer on the corresponding row
  // if we have it (so header/sections update too); else just refocus the graph.
  const refocus = (nodeId: string) => {
    const target = rows.find((r) => r.nodeId === nodeId);
    if (target) openDrawer(target.rowKey);
    else setFocusNodeId(nodeId);
  };

  return (
    <>
      <div onClick={closeDrawer} style={{ position: 'absolute', inset: 0, background: 'rgba(7,11,17,0.55)', zIndex: 50 }} />
      <div
        role="dialog"
        aria-label={`${kindLabel(row.kind)} detail: ${row.label}`}
        className="agent-labs-scrollbar"
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(560px, 92%)', zIndex: 51,
          background: 'var(--card, #0d1520)', borderLeft: `1px solid ${BORDER}`,
          display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, background: 'var(--card, #0d1520)', borderBottom: `1px solid ${BORDER}`, padding: '14px 18px', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ ...MONO, fontSize: 9, color: kindC, background: tint(kindC), border: `1px solid ${tint(kindC, 40)}`, borderRadius: 3, padding: '2px 6px' }}>{kindLabel(row.kind)}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...MONO, fontSize: 10, color: statusC }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusC }} /> {statusLabel(row.status)}
                </span>
              </div>
              <div style={{ ...SERIF, fontSize: 19, fontWeight: 600, color: INK, lineHeight: 1.2 }}>{row.label}</div>
              <div style={{ ...MONO, fontSize: 10, color: MUTED, marginTop: 5, display: 'flex', gap: 12 }}>
                {row.kind === 'entity' && <span>{row.dCount ?? 0}D · {row.mCount ?? 0}M · {row.jCount ?? 0}J</span>}
                <span>Updated {fmtDate(row.updatedAt)}</span>
              </div>
            </div>
            <button onClick={closeDrawer} aria-label="Close" style={{ background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', padding: 4 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Section title="Definition">
            <p style={{ ...SANS, fontSize: 13, color: INK_DIM, lineHeight: 1.55, margin: 0 }}>
              {row.description || row.expression || <span style={{ color: MUTED }}>No description yet.</span>}
            </p>
            {row.kind === 'measure' && (row.aggregate || row.expression) && (
              <div style={{ ...MONO, fontSize: 11, color: 'var(--mc-kind-measure)', marginTop: 8, background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '6px 9px' }}>
                {row.expression ? row.expression : `${row.aggregate}(${row.column ?? ''})`}{row.unit ? ` · ${row.unit}` : ''}
              </div>
            )}
          </Section>

          {activeModelId && (
            <Section title="Also called">
              <SynonymEditor modelId={activeModelId} tableKind={row.kind} defId={row.id} synonyms={row.synonyms} compact />
            </Section>
          )}

          {row.kind !== 'dimension' && entityDims.length > 0 && (
            <Section title={row.kind === 'entity' ? 'Dimensions' : 'Available breakdowns'}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {entityDims.slice(0, 24).map((d) => (
                  <button key={d.rowKey} onClick={() => openDrawer(d.rowKey)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'transparent', border: 'none', borderRadius: 3, padding: '4px 2px', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ ...SANS, fontSize: 12, color: INK }}>{d.label}</span>
                    <span style={{ ...MONO, fontSize: 9, color: MUTED }}>{d.dimensionType ?? 'categorical'} · {d.column ?? '—'}</span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="Where it lives">
            <div style={{ ...MONO, fontSize: 11, color: INK_DIM, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={13} color={MUTED} />
              <span style={{ wordBreak: 'break-all' }}>{row.fullPath}{row.column ? ` · ${row.column}` : ''}</span>
            </div>
          </Section>

          {/* Lineage — governed-model only */}
          <Section title="Lineage — what it's built from">
            {!activeModelGoverned ? (
              <UnlockNote />
            ) : lineage.loading ? (
              <span style={{ ...MONO, fontSize: 10, color: MUTED }}>Loading lineage…</span>
            ) : lineage.error ? (
              <span style={{ ...MONO, fontSize: 10, color: 'var(--mc-res-unrecognized)' }}>Lineage error: {lineage.error}</span>
            ) : lineage.graph ? (
              <CatalogLineageGraph graph={lineage.graph} focusId={focusNodeId ?? row.nodeId} onRefocus={refocus} />
            ) : (
              <span style={{ ...MONO, fontSize: 10, color: MUTED }}>No lineage for this definition.</span>
            )}
          </Section>

          {/* Example values — typed omission (never a faked empty panel) */}
          <Section title="Example values">
            <OmissionNote reason={lineage.omissions.find((o) => o.field === 'exampleValues')?.reason
              ?? 'Requires a live warehouse read (executeDatabricksSQL) — surfaced on demand, not stored in catalog metadata.'} />
          </Section>

          {/* Compiled SQL — read-only trust view */}
          {activeModelGoverned && lineage.compiledSql && (
            <Section title="Compiled SQL (read-only trust view)">
              <button onClick={() => setSqlOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, ...MONO, fontSize: 10, color: GOLD, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                <ChevronRight size={12} style={{ transform: sqlOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                {sqlOpen ? 'Hide' : 'Show'} SQL
              </button>
              {sqlOpen && (
                <pre style={{ ...MONO, fontSize: 10.5, color: INK_DIM, background: 'var(--terminal-bg, #0d1117)', border: `1px solid ${BORDER}`, borderRadius: 5, padding: 10, marginTop: 8, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {lineage.compiledSql}
                </pre>
              )}
            </Section>
          )}
        </div>

        {/* Footer — role/lens-aware */}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--card, #0d1520)', borderTop: `1px solid ${BORDER}`, padding: '12px 18px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {lens === 'govern' ? (
            <>
              {canAct && row.status === 'candidate' && (
                <FooterBtn primary icon={<CheckCircle2 size={14} />} label="Promote" onClick={() => onRowAction('promote', row)} />
              )}
              {canAct && row.status !== 'archived' && (
                <FooterBtn icon={<Archive size={14} />} label="Archive" onClick={() => onRowAction('archive', row)} />
              )}
              {!canAct && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...MONO, fontSize: 10, color: MUTED }}>
                  <Lock size={12} /> View only — you didn&apos;t author this
                </span>
              )}
            </>
          ) : (
            <>
              <FooterBtn primary icon={<ArrowUpRight size={14} />} label="Ask Inspector about this" onClick={() => onRowAction('ask', row)} />
              <FooterBtn icon={<Sparkles size={14} />} label="Refine as a metric" onClick={() => onRowAction('refine', row)} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ ...MONO, fontSize: 9, color: MUTED, letterSpacing: '0.08em', marginBottom: 8 }}>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}

function UnlockNote() {
  return (
    <div style={{ ...MONO, fontSize: 10.5, color: MUTED, lineHeight: 1.6, border: `1px dashed ${BORDER}`, borderRadius: 5, padding: '10px 12px' }}>
      <Lock size={12} style={{ verticalAlign: '-2px', marginRight: 6 }} />
      Lineage, compiled SQL, and consumers unlock once this model is <span style={{ color: GOLD }}>governed</span>.
    </div>
  );
}

function OmissionNote({ reason }: { reason: string }) {
  return (
    <div style={{ ...MONO, fontSize: 10, color: MUTED, lineHeight: 1.55, border: `1px dashed ${BORDER}`, borderRadius: 5, padding: '9px 11px' }}>
      Not loaded — {reason}
    </div>
  );
}

function FooterBtn({ label, icon, onClick, primary }: { label: string; icon: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, ...MONO, fontSize: 11, fontWeight: 600,
        padding: '7px 13px', borderRadius: 4, cursor: 'pointer',
        border: `1px solid ${primary ? GOLD : BORDER}`,
        background: primary ? GOLD : 'transparent',
        color: primary ? '#1A1206' : INK,
      }}
    >
      {icon}{label}
    </button>
  );
}

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : new Date(t).toISOString().slice(0, 10);
};
