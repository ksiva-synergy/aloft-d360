// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PowerBiSourceImpactPage from './powerbi-source-impact';
import { NODE_SEP, type SourceTreeNode } from '@/lib/powerbi/source-impact';

const replace = vi.fn();
let search = '';
vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@/lib/navigation/link', () => ({ default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const id = (...parts: string[]) => parts.join(NODE_SEP);
const node = (n: Partial<SourceTreeNode> & Pick<SourceTreeNode, 'id' | 'label' | 'level' | 'depth'>): SourceTreeNode => ({
  parent: null, system: 'databricks', system_label: 'Databricks', cls: 'warehouse', leaf: false, sources: 2, reports: 3, models: 2, tables: 2, ...n,
});
const tree: SourceTreeNode[] = [
  node({ id: 'databricks', label: 'Databricks', level: 'System', depth: 0 }),
  node({ id: id('databricks', 'adb-1'), parent: 'databricks', label: 'adb-1', level: 'Workspace', depth: 1 }),
  node({ id: id('databricks', 'adb-1', 'prod'), parent: id('databricks', 'adb-1'), label: 'prod', level: 'Catalog', depth: 2 }),
  node({ id: id('databricks', 'adb-1', 'prod', 'gold'), parent: id('databricks', 'adb-1', 'prod'), label: 'gold', level: 'Schema', depth: 3 }),
  node({ id: id('databricks', 'adb-1', 'prod', 'gold', 'fact_sales'), parent: id('databricks', 'adb-1', 'prod', 'gold'), label: 'fact_sales', level: 'Table', depth: 4, leaf: true, sources: 1 }),
  node({ id: 'sharepoint', label: 'SharePoint', level: 'System', depth: 0, system: 'sharepoint', system_label: 'SharePoint', cls: 'file', sources: 1, reports: 1 }),
];

describe('source impact page', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); search = ''; });

  it('starts from source systems and drills down the tree', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tree, total_sources: 3, node: null, impact: null, not_found: false }) });
    render(<PowerBiSourceImpactPage />);
    const systems = await screen.findByRole('region', { name: 'Source systems' });
    expect(within(systems).getByText('1 workspace · 2 sources')).toBeInTheDocument();

    const treeEl = screen.getByRole('tree', { name: 'Source hierarchy' });
    expect(within(treeEl).queryByText('adb-1')).not.toBeInTheDocument();
    fireEvent.click(within(treeEl).getByRole('button', { name: 'Expand Databricks' }));
    expect(within(treeEl).getByText('adb-1')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sources' }), { target: { value: 'fact' } });
    expect(within(treeEl).getByText('fact_sales')).toBeInTheDocument();
    fireEvent.click(within(treeEl).getByText('fact_sales'));
    expect(replace).toHaveBeenCalledWith(`/agent-lab/estate/powerbi/source-impact?node=${encodeURIComponent(tree[4]!.id)}`, { scroll: false });
  });

  it('shows impact for a whole schema with its path and drill-down', async () => {
    const schema = tree[3]!;
    search = `node=${encodeURIComponent(schema.id)}`;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      tree, total_sources: 3, node: schema.id, not_found: false,
      impact: {
        scope: { id: schema.id, level: 'Schema', label: 'gold', leaf: false, system: 'databricks', system_label: 'Databricks', cls: 'warehouse' },
        breadcrumb: tree.slice(0, 4).map((n) => ({ id: n.id, level: n.level, label: n.label })),
        sources: [{ id: 's:k1', key: 'k1', title: 'gold.fact_sales', subtitle: 'prod', group: 'Databricks · adb-1', cls: 'warehouse', system: 'databricks' }],
        hidden_sources: 0,
        tables: [{ id: 't:m1|sales', name: 'Sales', model_id: 'm1', model_name: 'Sales model' }],
        measures: [{ id: 'm:m1|revenue', name: 'Revenue', model_name: 'Sales model', table_ids: ['t:m1|sales'] }],
        reports: [
          { id: 'r1', name: 'Regional Sales', status: 'partial', model_name: 'Sales model', measure_ids: ['m:m1|revenue'], model_wide_table_ids: [] },
          { id: 'r2', name: 'Scorecard', status: 'ready', model_name: 'Sales model', measure_ids: [], model_wide_table_ids: ['t:m1|sales'] },
        ],
        edges: [
          { from: 's:k1', to: 't:m1|sales', kind: 'detected', cls: 'warehouse' },
          { from: 't:m1|sales', to: 'm:m1|revenue', kind: 'detected', cls: 'warehouse' },
          { from: 'm:m1|revenue', to: 'r1', kind: 'detected', cls: 'warehouse' },
          { from: 't:m1|sales', to: 'r2', kind: 'model_wide', cls: 'warehouse' },
        ],
      },
    }) });
    render(<PowerBiSourceImpactPage />);
    expect(await screen.findByText('Regional Sales')).toBeInTheDocument();
    expect(screen.getByText(/can affect/)).toHaveTextContent('Changing anything in schema gold can affect 2 reports through 1 semantic model.');
    const path = screen.getByRole('navigation', { name: 'Source path' });
    fireEvent.click(within(path).getByRole('button', { name: 'prod' }));
    expect(replace).toHaveBeenCalledWith(`/agent-lab/estate/powerbi/source-impact?node=${encodeURIComponent(tree[2]!.id)}`, { scroll: false });
    fireEvent.click(screen.getByRole('button', { name: /^fact_sales/ }));
    expect(replace).toHaveBeenLastCalledWith(`/agent-lab/estate/powerbi/source-impact?node=${encodeURIComponent(tree[4]!.id)}`, { scroll: false });
    await waitFor(() => expect(screen.getByText('model-wide only')).toBeInTheDocument());
  });
});
