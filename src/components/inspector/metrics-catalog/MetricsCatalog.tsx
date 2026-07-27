'use client';

import React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  useCatalogStore,
  selectFilteredRows,
  type SelectableState,
} from './catalog-store';
import type { CatalogRow, DefKind } from './catalog-types';
import { useCatalogData } from './use-catalog-data';
import { TopModelBar } from './TopModelBar';
import { SearchStrip } from './SearchStrip';
import { CoveragePanel } from './CoveragePanel';
import { FilterBar } from './FilterBar';
import { CatalogTable, type RowAction } from './CatalogTable';
import { BulkActionBar } from './BulkActionBar';
import { DetailDrawer } from './DetailDrawer';
import { EmptyModelState } from './EmptyModelState';
import { MONO, MUTED, INK_DIM, BORDER, GOLD } from './mc-ui';

/**
 * The Metrics catalog surface — the layered catalog that replaces the flat
 * governance queue. Owns: data loading (useCatalogData), model/lens URL sync,
 * and the mutation pipeline (row + bulk promote/archive → grouped API calls →
 * optimistic flip → refetch reconcile). Everything else reads the store.
 */
export function MetricsCatalog() {
  const { reload } = useCatalogData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const session = useCatalogStore((s) => s.session);
  const loading = useCatalogStore((s) => s.loading);
  const error = useCatalogStore((s) => s.error);
  const activeModelId = useCatalogStore((s) => s.activeModelId);
  const setActiveModel = useCatalogStore((s) => s.setActiveModel);
  const lens = useCatalogStore((s) => s.lens);
  const setLens = useCatalogStore((s) => s.setLens);
  const openDrawer = useCatalogStore((s) => s.openDrawer);
  const drawerOpen = useCatalogStore((s) => s.drawerOpen);
  const optimisticStatus = useCatalogStore((s) => s.optimisticStatus);
  const clearSelection = useCatalogStore((s) => s.clearSelection);
  const showToast = useCatalogStore((s) => s.showToast);
  const toast = useCatalogStore((s) => s.toast);
  const dismissToast = useCatalogStore((s) => s.dismissToast);

  const rows = useCatalogStore((s) => s.rows);
  const facets = useCatalogStore((s) => s.facets);
  const search = useCatalogStore((s) => s.search);
  const gapsOnly = useCatalogStore((s) => s.gapsOnly);
  const sort = useCatalogStore((s) => s.sort);

  // ── URL sync ────────────────────────────────────────────────────────────
  // Apply ?model / ?lens once the session is available (URL wins over default).
  const appliedUrl = React.useRef(false);
  React.useEffect(() => {
    if (!session || appliedUrl.current) return;
    appliedUrl.current = true;
    const urlModel = searchParams.get('model');
    const urlLens = searchParams.get('lens');
    if (urlLens === 'govern' || urlLens === 'explore') setLens(urlLens);
    if (urlModel && session.models.some((m) => m.id === urlModel) && urlModel !== activeModelId) {
      const governed = session.models.find((m) => m.id === urlModel)?.status === 'governed';
      setActiveModel(urlModel, governed);
    }
  }, [session, searchParams, activeModelId, setActiveModel, setLens]);

  // Reflect model/lens back into the URL (shallow replace).
  React.useEffect(() => {
    if (!session || !activeModelId) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set('model', activeModelId);
    params.set('lens', lens);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModelId, lens, session]);

  // ── Mutation pipeline (row + bulk) ──────────────────────────────────────
  const mutate = React.useCallback(
    async (action: 'promote' | 'archive', targets: CatalogRow[]) => {
      if (!activeModelId || targets.length === 0) return;
      const byKind = (k: DefKind) => targets.filter((r) => r.kind === k).map((r) => r.id);
      const entityIds = byKind('entity');
      const dimIds = byKind('dimension');
      const measIds = byKind('measure');

      const bodies: Record<string, unknown>[] = [];
      if (entityIds.length) bodies.push({ entityIds });
      if (dimIds.length) bodies.push({ definitionIds: dimIds, tableKind: 'dimension' });
      if (measIds.length) bodies.push({ definitionIds: measIds, tableKind: 'measure' });

      // Optimistic flip so coverage/facets/rows update before the refetch lands.
      optimisticStatus(targets.map((r) => r.rowKey), action === 'promote' ? 'governed' : 'archived');

      const results = await Promise.allSettled(
        bodies.map((b) =>
          fetch(`/api/inspector/semantic/${activeModelId}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(b),
          }).then(async (r) => {
            if (!r.ok) {
              const msg = r.status === 403 ? 'not authorized' : `${r.status}`;
              throw new Error(msg);
            }
            return r.json() as Promise<{ errors?: unknown[] }>;
          }),
        ),
      );

      const failed = results.filter((r) => r.status === 'rejected');
      const verb = action === 'promote' ? 'Promoted' : 'Archived';
      if (failed.length === 0) {
        showToast('success', `${verb} ${targets.length} definition${targets.length === 1 ? '' : 's'}.`);
      } else if (failed.length < bodies.length) {
        showToast('info', `${verb} some definitions; ${failed.length} group(s) failed.`);
      } else {
        const reason = failed[0].status === 'rejected' ? (failed[0].reason as Error).message : 'error';
        showToast('error', `Could not ${action} — ${reason}.`);
      }

      clearSelection();
      await reload(); // reconcile against server truth
    },
    [activeModelId, optimisticStatus, clearSelection, showToast, reload],
  );

  // ── Row / footer actions ────────────────────────────────────────────────
  const handleRowAction = React.useCallback(
    (action: RowAction, row: CatalogRow) => {
      if (action === 'promote') void mutate('promote', [row]);
      else if (action === 'archive') void mutate('archive', [row]);
      else if (action === 'ask') router.push(`/inspector?q=${encodeURIComponent(row.label)}`);
      else if (action === 'refine') router.push(`/inspector?q=${encodeURIComponent(`Define the metric "${row.label}"`)}`);
    },
    [mutate, router],
  );

  const handleDefine = React.useCallback(
    (term: string) => router.push(`/inspector?q=${encodeURIComponent(`Define "${term}" in the semantic model`)}`),
    [router],
  );

  // ── Derived summary ───────────────────────────────────────────────────
  const filteredCount = React.useMemo(() => {
    const state: SelectableState = {
      rows, facets, search: { raw: search.raw, activeDefIds: search.activeDefIds }, gapsOnly, sort, session,
    };
    return selectFilteredRows(state).length;
  }, [rows, facets, search.raw, search.activeDefIds, gapsOnly, sort, session]);

  const filterSummary = React.useMemo(() => {
    const parts: string[] = [];
    if (facets.status.length) parts.push(facets.status.join('/'));
    if (facets.type.length) parts.push(facets.type.join('/'));
    if (facets.theme.length) parts.push(facets.theme.join(', '));
    if (gapsOnly) parts.push('gaps only');
    if (search.raw) parts.push(`“${search.raw}”`);
    return parts.length ? parts.join(' · ') : 'all definitions';
  }, [facets, gapsOnly, search.raw]);

  // ── Render ─────────────────────────────────────────────────────────────
  const noModel = !!session && session.models.length === 0;
  const noDefs = !!activeModelId && !loading && !error && rows.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--wb-canvas)', overflow: 'hidden', position: 'relative' }}>
      <TopModelBar />

      {loading && !rows.length ? (
        <Centered><span style={{ ...MONO, fontSize: 11, color: MUTED }}>LOADING CATALOG…</span></Centered>
      ) : error ? (
        <Centered>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <span style={{ ...MONO, fontSize: 11, color: 'var(--mc-res-unrecognized)' }}>ERROR: {error}</span>
            <button onClick={() => void reload()} style={{ ...MONO, fontSize: 10, color: GOLD, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>RETRY</button>
          </div>
        </Centered>
      ) : noModel ? (
        <EmptyModelState reason="no-model" />
      ) : noDefs ? (
        <EmptyModelState reason="no-defs" />
      ) : (
        <>
          <SearchStrip onDefine={handleDefine} />
          <CoveragePanel />
          <FilterBar />
          {/* Result summary + lens hint */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 20px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
            <span style={{ ...MONO, fontSize: 10, color: INK_DIM }}>
              <span style={{ color: GOLD }}>{filteredCount}</span> definitions · {filterSummary}
            </span>
            <span style={{ ...MONO, fontSize: 9, color: MUTED }}>
              {lens === 'govern' ? 'Govern lens — review & promote' : 'Explore lens — browse & ask'}
            </span>
          </div>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <CatalogTable onRowClick={openDrawer} onRowAction={handleRowAction} />
          </div>

          <BulkActionBar onPromote={(rs) => void mutate('promote', rs)} onArchive={(rs) => void mutate('archive', rs)} />
        </>
      )}

      {drawerOpen && <DetailDrawer onRowAction={handleRowAction} />}
      {toast && <ToastView kind={toast.kind} message={toast.message} onDone={dismissToast} id={toast.id} />}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>;
}

function ToastView({ kind, message, onDone, id }: { kind: 'success' | 'error' | 'info'; message: string; onDone: () => void; id: number }) {
  React.useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [id, onDone]);
  const color = kind === 'success' ? 'var(--mc-status-governed)' : kind === 'error' ? 'var(--mc-res-unrecognized)' : GOLD;
  return (
    <div
      role="status"
      style={{
        position: 'absolute', bottom: 18, right: 18, zIndex: 60, maxWidth: 360,
        ...MONO, fontSize: 11, color: 'var(--wb-ink, #e6ecf4)',
        background: 'var(--card, #0d1520)', border: `1px solid ${color}`, borderLeft: `3px solid ${color}`,
        borderRadius: 5, padding: '10px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      {message}
    </div>
  );
}
