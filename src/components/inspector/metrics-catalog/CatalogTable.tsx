'use client';

import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  Sparkles,
  CheckCircle2,
  Archive,
  ChevronRight,
  Layers,
} from 'lucide-react';
import {
  useCatalogStore,
  selectSortedRows,
  type SelectableState,
} from './catalog-store';
import type { CatalogRow, SortCol } from './catalog-types';
import {
  MONO,
  SANS,
  MUTED,
  INK,
  INK_DIM,
  BORDER,
  GOLD,
  kindLabel,
  kindColorVar,
  statusLabel,
  statusColorVar,
  tint,
} from './mc-ui';

export type RowAction = 'promote' | 'archive' | 'ask' | 'refine';

interface Props {
  onRowClick: (rowKey: string) => void;
  onRowAction: (action: RowAction, row: CatalogRow) => void;
}

const ROW_H = 40;
const CLUSTER_H = 34; // slightly shorter for cluster header rows
const GOVERN_GRID = '34px minmax(200px,2fr) 92px 110px 150px minmax(140px,1.4fr) 92px 96px 132px';
const EXPLORE_GRID = 'minmax(200px,2fr) 92px minmax(200px,2.4fr) 150px minmax(140px,1.4fr) 128px';

export function CatalogTable({ onRowClick, onRowAction }: Props) {
  const lens = useCatalogStore((s) => s.lens);
  const sort = useCatalogStore((s) => s.sort);
  const setSort = useCatalogStore((s) => s.setSort);
  const selection = useCatalogStore((s) => s.selection);
  const toggleSelect = useCatalogStore((s) => s.toggleSelect);
  const session = useCatalogStore((s) => s.session);
  const drawerOpen = useCatalogStore((s) => s.drawerOpen);
  const expandedClusters = useCatalogStore((s) => s.expandedClusters);
  const toggleCluster = useCatalogStore((s) => s.toggleCluster);

  const rows = useCatalogStore((s) => s.rows);
  const facets = useCatalogStore((s) => s.facets);
  const search = useCatalogStore((s) => s.search);
  const gapsOnly = useCatalogStore((s) => s.gapsOnly);

  // Build the display view: filter+sort real rows, then interleave cluster parents.
  const view: CatalogRow[] = React.useMemo(() => {
    const state: SelectableState = {
      rows,
      facets,
      search: { raw: search.raw, activeDefIds: search.activeDefIds },
      gapsOnly,
      sort,
      session,
    };
    const sorted = selectSortedRows(state);

    // Group children by their cluster. For expanded clusters, replace the
    // children with [clusterParent, ...children]; for collapsed ones show only
    // the cluster parent.
    const clusterParents = new Map<string, CatalogRow>();
    const clusterChildren = new Map<string, CatalogRow[]>();

    for (const r of rows) {
      if (r.isClusterParent && r.clusterId) {
        clusterParents.set(r.clusterId, r);
      }
    }

    // Rebuild view with cluster parents injected
    const result: CatalogRow[] = [];
    const insertedClusters = new Set<string>();

    for (const r of sorted) {
      if (!r.clusterId) {
        // Regular (unclustered) row
        result.push(r);
        continue;
      }

      if (r.isClusterParent) continue; // handled when we encounter first child

      const cid = r.clusterId;
      if (!insertedClusters.has(cid)) {
        insertedClusters.add(cid);
        const parent = clusterParents.get(cid);
        if (parent) {
          result.push(parent);
        }
        const arr = clusterChildren.get(cid) ?? [];
        arr.push(r);
        clusterChildren.set(cid, arr);
      } else {
        const arr = clusterChildren.get(cid) ?? [];
        arr.push(r);
        clusterChildren.set(cid, arr);
      }
    }

    // Now splice in children for expanded clusters
    const final: CatalogRow[] = [];
    for (const r of result) {
      final.push(r);
      if (r.isClusterParent && r.clusterId && expandedClusters[r.clusterId]) {
        const children = clusterChildren.get(r.clusterId) ?? [];
        final.push(...children);
      }
    }

    return final;
  }, [rows, facets, search.raw, search.activeDefIds, gapsOnly, sort, session, expandedClusters]);

  const me = session?.currentUserId ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const canAct = (r: CatalogRow) => isAdmin || (!!me && r.createdBy === me);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: view.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (view[i]?.isClusterParent ? CLUSTER_H : ROW_H),
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
          display: 'grid',
          gridTemplateColumns: grid,
          alignItems: 'center',
          gap: 8,
          padding: '0 16px',
          height: 34,
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
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
            const r = view[vi.index]!;
            const selected = !!selection[r.rowKey];
            const open = drawerOpen === r.rowKey;

            if (r.isClusterParent && r.clusterId) {
              const isExpanded = !!expandedClusters[r.clusterId];
              return (
                <ClusterParentRow
                  key={r.rowKey}
                  r={r}
                  isExpanded={isExpanded}
                  onToggle={() => toggleCluster(r.clusterId!)}
                  top={vi.start}
                  height={CLUSTER_H}
                  grid={grid}
                  lens={lens}
                />
              );
            }

            const isChild = !!r.clusterId && !r.isClusterParent;

            return (
              <div
                key={r.rowKey}
                onClick={() => onRowClick(r.rowKey)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  height: ROW_H,
                  display: 'grid',
                  gridTemplateColumns: grid,
                  alignItems: 'center',
                  gap: 8,
                  padding: isChild ? '0 16px 0 32px' : '0 16px',
                  cursor: 'pointer',
                  background: open
                    ? 'rgba(253,181,21,0.07)'
                    : selected
                      ? 'rgba(253,181,21,0.04)'
                      : isChild
                        ? 'rgba(255,255,255,0.015)'
                        : 'transparent',
                  borderBottom: `1px solid ${BORDER}`,
                }}
                onMouseEnter={(e) => {
                  if (!open && !selected)
                    e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                }}
                onMouseLeave={(e) => {
                  if (!open && !selected)
                    e.currentTarget.style.background = isChild
                      ? 'rgba(255,255,255,0.015)'
                      : 'transparent';
                }}
              >
                {lens === 'govern' ? (
                  <GovernRow
                    r={r}
                    selected={selected}
                    canAct={canAct(r)}
                    onToggle={() => toggleSelect(r.rowKey)}
                    onRowAction={onRowAction}
                  />
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

// ── Cluster parent row ────────────────────────────────────────────────────────

function ClusterParentRow({
  r,
  isExpanded,
  onToggle,
  top,
  height,
  grid,
  lens,
}: {
  r: CatalogRow;
  isExpanded: boolean;
  onToggle: () => void;
  top: number;
  height: number;
  grid: string;
  lens: string;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${top}px)`,
        height,
        display: 'grid',
        gridTemplateColumns: grid,
        alignItems: 'center',
        gap: 8,
        padding: '0 16px',
        cursor: 'pointer',
        background: isExpanded ? 'rgba(253,181,21,0.05)' : 'rgba(255,255,255,0.02)',
        borderBottom: `1px solid ${BORDER}`,
        borderLeft: `2px solid ${isExpanded ? GOLD : 'rgba(253,181,21,0.3)'}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(253,181,21,0.07)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isExpanded
          ? 'rgba(253,181,21,0.05)'
          : 'rgba(255,255,255,0.02)';
      }}
    >
      {lens === 'govern' ? (
        <>
          {/* checkbox col — not selectable for cluster headers */}
          <span />
          {/* Name col */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <ChevronRight
              size={13}
              color={GOLD}
              style={{
                flexShrink: 0,
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)',
                transition: 'transform 0.15s',
              }}
            />
            <Layers size={12} color={GOLD} style={{ flexShrink: 0 }} />
            <span
              style={{
                ...SANS,
                fontSize: 12,
                color: GOLD,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontWeight: 600,
              }}
            >
              {r.clusterLabel}
            </span>
            <span
              style={{
                ...MONO,
                fontSize: 9,
                color: MUTED,
                background: 'rgba(253,181,21,0.1)',
                border: `1px solid rgba(253,181,21,0.2)`,
                borderRadius: 3,
                padding: '1px 5px',
                flexShrink: 0,
              }}
            >
              {r.clusterSize} variants
            </span>
          </span>
          {/* Remaining columns empty for cluster header */}
          <span />
          <span />
          <span
            style={{
              ...MONO,
              fontSize: 10,
              color: r.themeOverridden ? GOLD : INK_DIM,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {r.theme}
          </span>
          <span
            title={r.fullPath}
            style={{
              ...MONO,
              fontSize: 10,
              color: MUTED,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {shortPath(r.fullPath)}
          </span>
          <span />
          <span />
          <span />
        </>
      ) : (
        <>
          {/* Name col */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <ChevronRight
              size={13}
              color={GOLD}
              style={{
                flexShrink: 0,
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)',
                transition: 'transform 0.15s',
              }}
            />
            <Layers size={12} color={GOLD} style={{ flexShrink: 0 }} />
            <span
              style={{
                ...SANS,
                fontSize: 12,
                color: GOLD,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontWeight: 600,
              }}
            >
              {r.clusterLabel}
            </span>
            <span
              style={{
                ...MONO,
                fontSize: 9,
                color: MUTED,
                background: 'rgba(253,181,21,0.1)',
                border: `1px solid rgba(253,181,21,0.2)`,
                borderRadius: 3,
                padding: '1px 5px',
                flexShrink: 0,
              }}
            >
              {r.clusterSize} variants
            </span>
          </span>
          <span />
          <span />
          <span
            style={{
              ...MONO,
              fontSize: 10,
              color: INK_DIM,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {r.theme}
          </span>
          <span
            title={r.fullPath}
            style={{
              ...MONO,
              fontSize: 10,
              color: MUTED,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {shortPath(r.fullPath)}
          </span>
          <span />
        </>
      )}
    </div>
  );
}

// ── Column header ─────────────────────────────────────────────────────────────

function Th({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: SortCol;
  sort: { col: SortCol; dir: 'asc' | 'desc' };
  onSort: (c: SortCol) => void;
}) {
  const active = sort.col === col;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSort(col);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <span
        style={{
          ...MONO,
          fontSize: 9,
          color: active ? GOLD : MUTED,
          letterSpacing: '0.04em',
        }}
      >
        {label.toUpperCase()}
      </span>
      {active &&
        (sort.dir === 'asc' ? (
          <ArrowUp size={10} color={GOLD} />
        ) : (
          <ArrowDown size={10} color={GOLD} />
        ))}
    </button>
  );
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

function KindChip({ r }: { r: CatalogRow }) {
  const c = kindColorVar(r.kind);
  return (
    <span
      style={{
        ...MONO,
        fontSize: 9,
        color: c,
        background: tint(c),
        border: `1px solid ${tint(c, 40)}`,
        borderRadius: 3,
        padding: '2px 6px',
        whiteSpace: 'nowrap',
      }}
    >
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
      <span
        style={{
          ...SANS,
          fontSize: 12.5,
          color: INK,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {r.label}
      </span>
    </span>
  );
}

const shortPath = (p: string) => {
  const parts = p.split('.');
  return parts.length > 2 ? `…${parts.slice(-2).join('.')}` : p;
};

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toISOString().slice(0, 10);
};

// ── Row layouts ───────────────────────────────────────────────────────────────

function GovernRow({
  r,
  selected,
  canAct,
  onToggle,
  onRowAction,
}: {
  r: CatalogRow;
  selected: boolean;
  canAct: boolean;
  onToggle: () => void;
  onRowAction: (a: RowAction, r: CatalogRow) => void;
}) {
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
      <span>
        <KindChip r={r} />
      </span>
      <span>
        <StatusChip r={r} />
      </span>
      <span
        style={{
          ...MONO,
          fontSize: 10,
          color: r.themeOverridden ? GOLD : INK_DIM,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {r.theme}
      </span>
      <span
        title={r.fullPath}
        style={{
          ...MONO,
          fontSize: 10,
          color: MUTED,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {shortPath(r.fullPath)}
      </span>
      <span style={{ ...MONO, fontSize: 10, color: MUTED }}>
        {r.kind === 'entity' ? `${r.dCount ?? 0}D ${r.mCount ?? 0}M ${r.jCount ?? 0}J` : '—'}
      </span>
      <span style={{ ...MONO, fontSize: 10, color: MUTED }}>{fmtDate(r.updatedAt)}</span>
      <span
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}
      >
        {canAct && r.status === 'candidate' && (
          <IconBtn
            title="Promote to governed"
            color="var(--mc-status-governed)"
            onClick={() => onRowAction('promote', r)}
          >
            <CheckCircle2 size={13} />
          </IconBtn>
        )}
        {canAct && r.status !== 'archived' && (
          <IconBtn title="Archive" color={MUTED} onClick={() => onRowAction('archive', r)}>
            <Archive size={13} />
          </IconBtn>
        )}
      </span>
    </>
  );
}

function ExploreRow({
  r,
  onRowAction,
}: {
  r: CatalogRow;
  onRowAction: (a: RowAction, r: CatalogRow) => void;
}) {
  const def =
    r.description ||
    r.expression ||
    (r.kind === 'measure' ? `${r.aggregate ?? ''} ${r.column ?? ''}`.trim() : r.column || '');
  return (
    <>
      <NameCell r={r} />
      <span>
        <KindChip r={r} />
      </span>
      <span
        style={{
          ...SANS,
          fontSize: 11.5,
          color: INK_DIM,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {def || '—'}
      </span>
      <span
        style={{
          ...MONO,
          fontSize: 10,
          color: INK_DIM,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {r.theme}
      </span>
      <span
        title={r.fullPath}
        style={{
          ...MONO,
          fontSize: 10,
          color: MUTED,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {shortPath(r.fullPath)}
      </span>
      <span
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}
      >
        <IconBtn
          title="Ask Inspector"
          color={GOLD}
          onClick={() => onRowAction('ask', r)}
        >
          <ArrowUpRight size={13} />
        </IconBtn>
        <IconBtn
          title="Refine as a metric"
          color={MUTED}
          onClick={() => onRowAction('refine', r)}
        >
          <Sparkles size={13} />
        </IconBtn>
      </span>
    </>
  );
}

function IconBtn({
  title,
  color,
  onClick,
  children,
}: {
  title: string;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: 4,
        borderRadius: 3,
        border: `1px solid ${BORDER}`,
        background: 'transparent',
        color,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
