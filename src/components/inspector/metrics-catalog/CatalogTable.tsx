'use client';

import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, ArrowDown, ArrowUpRight, Sparkles, CheckCircle2, Archive } from 'lucide-react';
import {
  useCatalogStore,
  selectSortedRows,
  type SelectableState,
} from './catalog-store';
import type { CatalogRow, SortCol } from './catalog-types';
import {
  MONO, SANS, MUTED, INK, INK_DIM, BORDER, GOLD,
  kindLabel, kindColorVar, statusLabel, statusColorVar, tint,
} from './mc-ui';

export type RowAction = 'promote' | 'archive' | 'ask' | 'refine';

interface Props {
  onRowClick: (rowKey: string) => void;
  onRowAction: (action: RowAction, row: CatalogRow) => void;
}

const ROW_H = 40;
const GOVERN_GRID = '34px minmax(180px,2fr) 92px 110px 150px minmax(140px,1.4fr) 92px 96px 132px';
const EXPLORE_GRID = 'minmax(180px,2fr) 92px minmax(200px,2.4fr) 150px minmax(140px,1.4fr) 128px';

export function CatalogTable({ onRowClick, onRowAction }: Props) {
  const lens = useCatalogStore((s) => s.lens);
  const sort = useCatalogStore((s) => s.sort);
  const setSort = useCatalogStore((s) => s.setSort);
  const selection = useCatalogStore((s) => s.selection);
  const toggleSelect = useCatalogStore((s) => s.toggleSelect);
  const session = useCatalogStore((s) => s.session);
  const drawerOpen = useCatalogStore((s) => s.drawerOpen);

  // Recompute the filtered+sorted view when any input slice changes.
  const rows = useCatalogStore((s) => s.rows);
  const facets = useCatalogStore((s) => s.facets);
  const search = useCatalogStore((s) => s.search);
  const gapsOnly = useCatalogStore((s) => s.gapsOnly);
  const view: CatalogRow[] = React.useMemo(() => {
    const state: SelectableState = {
      rows,
      facets,
      search: { raw: search.raw, activeDefIds: search.activeDefIds },
      gapsOnly,
      sort,
      session,
    };
    return selectSortedRows(state);
  }, [rows, facets, search.raw, search.activeDefIds, gapsOnly, sort, session]);

  const me = session?.currentUserId ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const canAct = (r: CatalogRow) => isAdmin || (!!me && r.createdBy === me);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: view.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  const grid = lens === 'govern' ? GOVERN_GRID : EXPLORE_GRID;

  if (!view.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ ...MONO, fontSize: 12, color: MUTED }}>No definitions match these filters.</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 8,
          padding: '0 16px', height: 34, borderBottom: `1px solid ${BORDER}`, flexShrink: 0,
        }}
      >
        {lens === 'govern' ? (
          <>
            <span />
            <Th label="Name" col="label" sort={sort} onSort={setSort} />
            <Th label="Type" col="kind" sort={sort} onSort={setSort} />
            <Th label="Status" col="status" sort={sort} onSort={setSort} />
            <Th label="Theme" col="theme" sort={sort} onSort={setSort} />
            <Th label="Source" col="source" sort={sort} onSort={setSort} />
            <Th label="D/M/J" col="composition" sort={sort} onSort={setSort} />
            <Th label="Updated" col="updated" sort={sort} onSort={setSort} />
            <span style={{ ...MONO, fontSize: 9, color: MUTED, textAlign: 'right' }}>ACTIONS</span>
          </>
        ) : (
          <>
            <Th label="Name" col="label" sort={sort} onSort={setSort} />
            <Th label="Type" col="kind" sort={sort} onSort={setSort} />
            <span style={{ ...MONO, fontSize: 9, color: MUTED }}>DEFINITION</span>
            <Th label="Theme" col="theme" sort={sort} onSort={setSort} />
            <Th label="Source" col="source" sort={sort} onSort={setSort} />
            <span style={{ ...MONO, fontSize: 9, color: MUTED, textAlign: 'right' }}>ACTIONS</span>
          </>
        )}
      </div>

      {/* Virtualized body */}
      <div ref={scrollRef} className="agent-labs-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const r = view[vi.index];
            const selected = !!selection[r.rowKey];
            const open = drawerOpen === r.rowKey;
            return (
              <div
                key={r.rowKey}
                onClick={() => onRowClick(r.rowKey)}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`,
                  height: ROW_H, display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 8,
                  padding: '0 16px', cursor: 'pointer',
                  background: open ? 'rgba(253,181,21,0.07)' : selected ? 'rgba(253,181,21,0.04)' : 'transparent',
                  borderBottom: `1px solid ${BORDER}`,
                }}
                onMouseEnter={(e) => { if (!open && !selected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                onMouseLeave={(e) => { if (!open && !selected) e.currentTarget.style.background = 'transparent'; }}
              >
                {lens === 'govern' ? (
                  <GovernRow r={r} selected={selected} canAct={canAct(r)} onToggle={() => toggleSelect(r.rowKey)} onRowAction={onRowAction} />
                ) : (
                  <ExploreRow r={r} onRowAction={onRowAction} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Th({ label, col, sort, onSort }: { label: string; col: SortCol; sort: { col: SortCol; dir: 'asc' | 'desc' }; onSort: (c: SortCol) => void }) {
  const active = sort.col === col;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSort(col); }}
      style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
    >
      <span style={{ ...MONO, fontSize: 9, color: active ? GOLD : MUTED, letterSpacing: '0.04em' }}>{label.toUpperCase()}</span>
      {active && (sort.dir === 'asc' ? <ArrowUp size={10} color={GOLD} /> : <ArrowDown size={10} color={GOLD} />)}
    </button>
  );
}

function KindChip({ r }: { r: CatalogRow }) {
  const c = kindColorVar(r.kind);
  return (
    <span style={{ ...MONO, fontSize: 9, color: c, background: tint(c), border: `1px solid ${tint(c, 40)}`, borderRadius: 3, padding: '2px 6px', whiteSpace: 'nowrap' }}>
      {kindLabel(r.kind)}
    </span>
  );
}

function StatusChip({ r }: { r: CatalogRow }) {
  const c = statusColorVar(r.status);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...MONO, fontSize: 10, color: c }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
      {statusLabel(r.status)}
    </span>
  );
}

function NameCell({ r }: { r: CatalogRow }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span style={{ ...SANS, fontSize: 12.5, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
    </span>
  );
}

const shortPath = (p: string) => { const parts = p.split('.'); return parts.length > 2 ? `…${parts.slice(-2).join('.')}` : p; };

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toISOString().slice(0, 10);
};

function GovernRow({ r, selected, canAct, onToggle, onRowAction }: { r: CatalogRow; selected: boolean; canAct: boolean; onToggle: () => void; onRowAction: (a: RowAction, r: CatalogRow) => void }) {
  return (
    <>
      <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={selected}
          disabled={!canAct}
          onChange={onToggle}
          title={canAct ? undefined : 'You can only action definitions you authored.'}
          style={{ cursor: canAct ? 'pointer' : 'not-allowed', accentColor: GOLD }}
        />
      </span>
      <NameCell r={r} />
      <span><KindChip r={r} /></span>
      <span><StatusChip r={r} /></span>
      <span style={{ ...MONO, fontSize: 10, color: r.themeOverridden ? GOLD : INK_DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.theme}</span>
      <span title={r.fullPath} style={{ ...MONO, fontSize: 10, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortPath(r.fullPath)}</span>
      <span style={{ ...MONO, fontSize: 10, color: MUTED }}>
        {r.kind === 'entity' ? `${r.dCount ?? 0}D ${r.mCount ?? 0}M ${r.jCount ?? 0}J` : '—'}
      </span>
      <span style={{ ...MONO, fontSize: 10, color: MUTED }}>{fmtDate(r.updatedAt)}</span>
      <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {canAct && r.status === 'candidate' && (
          <IconBtn title="Promote to governed" color="var(--mc-status-governed)" onClick={() => onRowAction('promote', r)}><CheckCircle2 size={13} /></IconBtn>
        )}
        {canAct && r.status !== 'archived' && (
          <IconBtn title="Archive" color={MUTED} onClick={() => onRowAction('archive', r)}><Archive size={13} /></IconBtn>
        )}
      </span>
    </>
  );
}

function ExploreRow({ r, onRowAction }: { r: CatalogRow; onRowAction: (a: RowAction, r: CatalogRow) => void }) {
  const def = r.description || r.expression || (r.kind === 'measure' ? `${r.aggregate ?? ''} ${r.column ?? ''}`.trim() : r.column || '');
  return (
    <>
      <NameCell r={r} />
      <span><KindChip r={r} /></span>
      <span style={{ ...SANS, fontSize: 11.5, color: INK_DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{def || '—'}</span>
      <span style={{ ...MONO, fontSize: 10, color: INK_DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.theme}</span>
      <span title={r.fullPath} style={{ ...MONO, fontSize: 10, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortPath(r.fullPath)}</span>
      <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <IconBtn title="Ask Inspector" color={GOLD} onClick={() => onRowAction('ask', r)}><ArrowUpRight size={13} /></IconBtn>
        <IconBtn title="Refine as a metric" color={MUTED} onClick={() => onRowAction('refine', r)}><Sparkles size={13} /></IconBtn>
      </span>
    </>
  );
}

function IconBtn({ title, color, onClick, children }: { title: string; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', padding: 4, borderRadius: 3, border: `1px solid ${BORDER}`, background: 'transparent', color, cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}
