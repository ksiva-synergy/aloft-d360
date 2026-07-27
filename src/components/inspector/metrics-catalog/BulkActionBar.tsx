'use client';

import React from 'react';
import { X, CheckCircle2, Archive, ChevronsUp } from 'lucide-react';
import {
  useCatalogStore,
  selectFilteredRows,
  type SelectableState,
} from './catalog-store';
import type { CatalogRow } from './catalog-types';
import { MONO, MUTED, INK, BORDER, GOLD } from './mc-ui';

/**
 * Bulk action bar — appears on selection. Replaces the old blind "Promote All
 * (692)": every bulk action is SCOPED and CONFIRMED with an exact count.
 *   - "Promote all in '{theme}'" acts on the current filtered+facet view ∩ the
 *     single selected theme (only shown when exactly one theme facet is active).
 *   - "Promote {n} for review" / "Archive selected" act on the selection.
 * Only rows the caller can act on (admin, or own authored) are counted — the
 * API enforces the same gate regardless.
 */

interface Props {
  onPromote: (rows: CatalogRow[]) => void;
  onArchive: (rows: CatalogRow[]) => void;
}

type Pending = { kind: 'promote' | 'archive'; label: string; rows: CatalogRow[] } | null;

export function BulkActionBar({ onPromote, onArchive }: Props) {
  const rows = useCatalogStore((s) => s.rows);
  const facets = useCatalogStore((s) => s.facets);
  const search = useCatalogStore((s) => s.search);
  const gapsOnly = useCatalogStore((s) => s.gapsOnly);
  const sort = useCatalogStore((s) => s.sort);
  const session = useCatalogStore((s) => s.session);
  const selection = useCatalogStore((s) => s.selection);
  const clearSelection = useCatalogStore((s) => s.clearSelection);

  const [pending, setPending] = React.useState<Pending>(null);

  const me = session?.currentUserId ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const canAct = React.useCallback((r: CatalogRow) => isAdmin || (!!me && r.createdBy === me), [isAdmin, me]);

  const selectedRows = React.useMemo(
    () => rows.filter((r) => selection[r.rowKey]),
    [rows, selection],
  );
  const selectedCount = selectedRows.length;

  const filteredView = React.useMemo(() => {
    const state: SelectableState = {
      rows, facets, search: { raw: search.raw, activeDefIds: search.activeDefIds }, gapsOnly, sort, session,
    };
    return selectFilteredRows(state);
  }, [rows, facets, search.raw, search.activeDefIds, gapsOnly, sort, session]);

  if (selectedCount === 0) return null;

  const promotable = (rs: CatalogRow[]) => rs.filter((r) => canAct(r) && r.status === 'candidate');
  const archivable = (rs: CatalogRow[]) => rs.filter((r) => canAct(r) && r.status !== 'archived');

  const singleTheme = facets.theme.length === 1 ? facets.theme[0] : null;
  const themePromotable = singleTheme ? promotable(filteredView) : [];

  const run = () => {
    if (!pending) return;
    if (pending.kind === 'promote') onPromote(pending.rows);
    else onArchive(pending.rows);
    setPending(null);
  };

  return (
    <div
      style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '10px 18px', borderTop: `1px solid ${BORDER}`, background: 'rgba(253,181,21,0.05)',
      }}
    >
      <span style={{ ...MONO, fontSize: 11, color: GOLD, fontWeight: 600 }}>{selectedCount} selected</span>
      <button onClick={clearSelection} style={{ display: 'flex', alignItems: 'center', gap: 4, ...MONO, fontSize: 10, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer' }}>
        <X size={11} /> clear
      </button>

      <div style={{ flex: 1 }} />

      {pending ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...MONO, fontSize: 11, color: INK }}>{pending.label} — {pending.rows.length} definition{pending.rows.length === 1 ? '' : 's'}?</span>
          <BarBtn primary label="Confirm" onClick={run} />
          <BarBtn label="Cancel" onClick={() => setPending(null)} />
        </div>
      ) : (
        <>
          {singleTheme && themePromotable.length > 0 && (
            <BarBtn
              icon={<ChevronsUp size={13} />}
              label={`Promote all in '${singleTheme}' (${themePromotable.length})`}
              onClick={() => setPending({ kind: 'promote', label: `Promote all candidates in '${singleTheme}'`, rows: themePromotable })}
            />
          )}
          <BarBtn
            icon={<Archive size={13} />}
            label={`Archive selected (${archivable(selectedRows).length})`}
            disabled={archivable(selectedRows).length === 0}
            onClick={() => setPending({ kind: 'archive', label: 'Archive selected', rows: archivable(selectedRows) })}
          />
          <BarBtn
            primary
            icon={<CheckCircle2 size={13} />}
            label={`Promote ${promotable(selectedRows).length} for review`}
            disabled={promotable(selectedRows).length === 0}
            onClick={() => setPending({ kind: 'promote', label: 'Promote selected candidates', rows: promotable(selectedRows) })}
          />
        </>
      )}
    </div>
  );
}

function BarBtn({ label, icon, onClick, primary, disabled }: { label: string; icon?: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, ...MONO, fontSize: 10.5, fontWeight: 600,
        padding: '6px 12px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
        border: `1px solid ${primary && !disabled ? GOLD : BORDER}`,
        background: primary && !disabled ? GOLD : 'transparent',
        color: disabled ? MUTED : primary ? '#1A1206' : INK,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}{label}
    </button>
  );
}
