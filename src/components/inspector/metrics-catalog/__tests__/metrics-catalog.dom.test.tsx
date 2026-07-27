// @vitest-environment jsdom
/**
 * Render invariants no pure-logic test can guard:
 *  1. An UNRECOGNIZED search term must render the refusal ("won't fabricate a
 *     result") + a Define affordance — never a fabricated match. This is the
 *     spec's core honesty acceptance for the search strip.
 *  2. The Govern↔Explore lens reweights the SAME table: Govern shows Status +
 *     D/M/J columns; Explore shows a Definition column and no Status.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchStrip } from '../SearchStrip';
import { CatalogTable } from '../CatalogTable';
import { useCatalogStore } from '../catalog-store';
import type { CatalogRow } from '../catalog-types';

// @tanstack/react-virtual needs ResizeObserver (absent in jsdom).
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const sampleRow: CatalogRow = {
  id: 'm1', rowKey: 'measure:m1', kind: 'measure', nodeId: 'meas:m1', label: 'Deficiency count',
  status: 'candidate', description: 'count of deficiencies', synonyms: [], entityId: 'e1', entityLabel: 'Deficiency',
  fullPath: 'curated_db.deffect_list.deficiency', column: 'cnt', theme: 'Inspections & Defects', themeOverridden: false,
  createdBy: null, updatedAt: '2026-07-01T00:00:00Z', isDraft: false, metricType: 'simple', aggregate: 'count',
};

function seed(over: Partial<ReturnType<typeof useCatalogStore.getState>> = {}) {
  useCatalogStore.setState({
    session: { models: [{ id: 'model1', name: 'M', status: 'governed' }], defaultModelId: 'model1', isAdmin: true, currentUserId: 'me' },
    activeModelId: 'model1',
    activeModelGoverned: true,
    rows: [sampleRow],
    lens: 'govern',
    facets: { status: [], type: [], theme: [], source: [], layer: [] },
    search: { raw: '', resolving: false, resolveError: null, modelGoverned: true, resolvedTerms: [], activeDefIds: [] },
    gapsOnly: false,
    sort: { col: 'label', dir: 'asc' },
    selection: {},
    drawerOpen: null,
    ...over,
  });
}

describe('SearchStrip — unrecognized refusal (honesty invariant)', () => {
  beforeEach(() => {
    seed();
    vi.spyOn(global, 'fetch').mockImplementation(((url: string) => {
      if (String(url).includes('/resolve-intent')) {
        return Promise.resolve(jsonResponse({ terms: [{ term: 'zzqq', candidates: [], resolution: 'unrecognized' }] }));
      }
      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch);
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the refusal + Define it, never a fabricated match', async () => {
    render(<SearchStrip onDefine={() => {}} />);
    const input = screen.getByPlaceholderText(/Search or resolve/i);
    fireEvent.change(input, { target: { value: 'zzqq' } });
    fireEvent.click(screen.getByText('Resolve'));

    expect(await screen.findByText(/won.t fabricate a result/i)).toBeTruthy();
    expect(screen.getByText(/Define it/i)).toBeTruthy();
  });
});

describe('CatalogTable — lens reweights the same table', () => {
  beforeEach(() => seed());

  it('Govern shows Status + D/M/J; Explore shows Definition and no Status', () => {
    render(<CatalogTable onRowClick={() => {}} onRowAction={() => {}} />);
    // Govern lens (seeded default)
    expect(screen.getByText('STATUS')).toBeTruthy();
    expect(screen.getByText('D/M/J')).toBeTruthy();
    expect(screen.queryByText('DEFINITION')).toBeNull();

    // Flip to Explore
    act(() => useCatalogStore.getState().setLens('explore'));
    expect(screen.getByText('DEFINITION')).toBeTruthy();
    expect(screen.queryByText('STATUS')).toBeNull();
    expect(screen.queryByText('D/M/J')).toBeNull();
  });
});
