/**
 * Pure store selectors — the shared derived data the whole surface renders from.
 * Facet/search/gaps filtering, sort ordering, coverage rollup, and facet counts.
 */
import { describe, it, expect } from 'vitest';
import {
  selectFilteredRows,
  sortRows,
  selectCoverage,
  selectFacetCounts,
  type SelectableState,
  type FacetState,
} from '../catalog-store';
import type { CatalogRow, GovStatus, DefKind } from '../catalog-types';

let seq = 0;
function row(p: Partial<CatalogRow> & { kind: DefKind; label: string; status: GovStatus; theme: string }): CatalogRow {
  const id = String(++seq);
  return {
    id,
    rowKey: `${p.kind}:${id}`,
    kind: p.kind,
    nodeId: `${p.kind === 'entity' ? 'e' : p.kind === 'measure' ? 'meas' : 'dim'}:${id}`,
    label: p.label,
    status: p.status,
    description: null,
    synonyms: p.synonyms ?? [],
    entityId: p.entityId ?? 'ent1',
    entityLabel: 'Ent 1',
    fullPath: p.fullPath ?? 'curated_db.deffect_list.t',
    column: p.column ?? null,
    theme: p.theme,
    themeOverridden: false,
    createdBy: p.createdBy ?? null,
    updatedAt: p.updatedAt ?? '2026-07-01T00:00:00Z',
    isDraft: p.isDraft ?? false,
    dimensionType: p.dimensionType,
    metricType: p.metricType,
  };
}

const EMPTY_FACETS: FacetState = { status: [], type: [], theme: [], source: [], layer: [] };

function baseState(rows: CatalogRow[], over: Partial<SelectableState> = {}): SelectableState {
  return {
    rows,
    facets: EMPTY_FACETS,
    search: { raw: '', activeDefIds: [] },
    gapsOnly: false,
    sort: { col: 'label', dir: 'asc' },
    session: { models: [], defaultModelId: null, isAdmin: false, currentUserId: 'me' },
    ...over,
  };
}

describe('selectFilteredRows', () => {
  const rows = [
    row({ kind: 'measure', label: 'Alpha', status: 'governed', theme: 'A' }),
    row({ kind: 'dimension', label: 'Beta', status: 'candidate', theme: 'B' }),
    row({ kind: 'measure', label: 'Gamma', status: 'candidate', theme: 'A', synonyms: ['synx'] }),
    row({ kind: 'dimension', label: 'Delta', status: 'draft', theme: 'B', isDraft: true, createdBy: 'me' }),
  ];

  it('filters by status facet', () => {
    const out = selectFilteredRows(baseState(rows, { facets: { ...EMPTY_FACETS, status: ['governed'] } }));
    expect(out.map((r) => r.label)).toEqual(['Alpha']);
  });

  it('filters by type facet', () => {
    const out = selectFilteredRows(baseState(rows, { facets: { ...EMPTY_FACETS, type: ['dimension'] } }));
    expect(out.map((r) => r.label).sort()).toEqual(['Beta', 'Delta']);
  });

  it('filters by theme facet', () => {
    const out = selectFilteredRows(baseState(rows, { facets: { ...EMPTY_FACETS, theme: ['A'] } }));
    expect(out.map((r) => r.label).sort()).toEqual(['Alpha', 'Gamma']);
  });

  it('raw search matches label and synonyms', () => {
    expect(selectFilteredRows(baseState(rows, { search: { raw: 'gam', activeDefIds: [] } })).map((r) => r.label)).toEqual(['Gamma']);
    expect(selectFilteredRows(baseState(rows, { search: { raw: 'synx', activeDefIds: [] } })).map((r) => r.label)).toEqual(['Gamma']);
  });

  it('activeDefIds narrows to a resolved definition', () => {
    const target = rows[2];
    const out = selectFilteredRows(baseState(rows, { search: { raw: '', activeDefIds: [target.id] } }));
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('Gamma');
  });

  it('my_drafts layer only returns the viewer\'s drafts', () => {
    const out = selectFilteredRows(baseState(rows, { facets: { ...EMPTY_FACETS, layer: ['my_drafts'] } }));
    expect(out.map((r) => r.label)).toEqual(['Delta']);
  });

  it('gapsOnly restricts to under-governed themes', () => {
    // Theme A: 1 gov / 1 cand → 50% (not a gap at threshold 0.5). Theme B: 0 gov → gap.
    const out = selectFilteredRows(baseState(rows, { gapsOnly: true }));
    expect(out.every((r) => r.theme === 'B')).toBe(true);
  });
});

describe('sortRows', () => {
  const rows = [
    row({ kind: 'measure', label: 'B', status: 'candidate', theme: 'A' }),
    row({ kind: 'measure', label: 'A', status: 'governed', theme: 'A' }),
  ];
  it('sorts by label asc/desc', () => {
    expect(sortRows(rows, { col: 'label', dir: 'asc' }).map((r) => r.label)).toEqual(['A', 'B']);
    expect(sortRows(rows, { col: 'label', dir: 'desc' }).map((r) => r.label)).toEqual(['B', 'A']);
  });
  it('sorts by status (governed first)', () => {
    expect(sortRows(rows, { col: 'status', dir: 'asc' }).map((r) => r.status)).toEqual(['governed', 'candidate']);
  });
});

describe('selectCoverage', () => {
  const rows = [
    row({ kind: 'measure', label: 'A', status: 'governed', theme: 'Reg' }),
    row({ kind: 'measure', label: 'B', status: 'candidate', theme: 'Reg' }),
    row({ kind: 'measure', label: 'C', status: 'candidate', theme: 'Ops' }),
    row({ kind: 'measure', label: 'D', status: 'candidate', theme: 'Ops' }),
  ];
  it('rolls up gov/cand/draft and flags gaps', () => {
    const cov = selectCoverage(rows);
    const reg = cov.find((c) => c.theme === 'Reg')!;
    const ops = cov.find((c) => c.theme === 'Ops')!;
    expect(reg.governed).toBe(1);
    expect(reg.candidate).toBe(1);
    expect(reg.govPct).toBeCloseTo(0.5);
    expect(reg.gap).toBe(false); // 0.5 is not below the 0.5 bar
    expect(ops.govPct).toBe(0);
    expect(ops.gap).toBe(true);
  });
});

describe('selectFacetCounts', () => {
  const rows = [
    row({ kind: 'measure', label: 'A', status: 'governed', theme: 'X' }),
    row({ kind: 'dimension', label: 'B', status: 'candidate', theme: 'X' }),
    row({ kind: 'dimension', label: 'C', status: 'draft', theme: 'Y', isDraft: true, createdBy: 'me' }),
  ];
  it('counts per facet option + personal layers', () => {
    const c = selectFacetCounts(rows, 'me');
    expect(c.type.find((t) => t.value === 'dimension')?.count).toBe(2);
    expect(c.status.find((s) => s.value === 'governed')?.count).toBe(1);
    expect(c.layer.my_drafts).toBe(1);
    expect(c.layer.authored).toBe(1);
  });
});
