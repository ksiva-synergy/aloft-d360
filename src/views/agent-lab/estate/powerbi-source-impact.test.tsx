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
  parent: null, system: 'databricks', system_label: 'Databricks', cls: 'warehouse', leaf: false, sources: 2, leaf_level: 'Table', reports: 3, models: 2, tables: 2, measures: 4, ...n,
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

  it('opens a whole schema on its table list, with reports and the graph in tabs', async () => {
    const schema = tree[3]!;
    search = `node=${encodeURIComponent(schema.id)}`;
    const impact = {
        scope: { id: schema.id, level: 'Schema', label: 'gold', leaf: false, system: 'databricks', system_label: 'Databricks', cls: 'warehouse' },
        breadcrumb: tree.slice(0, 4).map((n) => ({ id: n.id, level: n.level, label: n.label })),
        leaf_level: 'Table',
        totals: { sources: 1, leaves: 1, tables: 1, measures: 1, reports: 2, models: 1 },
        focus: null as null | { id: string; kind: string; label: string },
        sources: [{ id: 's:k1', key: 'k1', title: 'gold.fact_sales', subtitle: 'prod', group: 'Databricks · adb-1', path: null, cls: 'warehouse', system: 'databricks' }],
        hidden_sources: 0, hidden_tables: 0, hidden_measures: 0, hidden_reports: 0,
        tables: [{ id: 't:m1|sales', name: 'Sales', model_id: 'm1', model_name: 'Sales model' }],
        measures: [{ id: 'm:m1|revenue', name: 'Revenue', model_name: 'Sales model', table_ids: ['t:m1|sales'] }],
        reports: [
          { id: 'r1', name: 'Regional Sales', status: 'partial', model_name: 'Sales model', measure_ids: ['m:m1|revenue'], model_wide_table_ids: [], measure_count: 1 },
          { id: 'r2', name: 'Scorecard', status: 'ready', model_name: 'Sales model', measure_ids: [], model_wide_table_ids: ['t:m1|sales'], measure_count: 0 },
        ],
        edges: [
          { from: 's:k1', to: 't:m1|sales', kind: 'detected', cls: 'warehouse' },
          { from: 't:m1|sales', to: 'm:m1|revenue', kind: 'detected', cls: 'warehouse' },
          { from: 'm:m1|revenue', to: 'r1', kind: 'detected', cls: 'warehouse' },
          { from: 't:m1|sales', to: 'r2', kind: 'model_wide', cls: 'warehouse' },
        ],
        source_rows: [{ id: tree[4]!.id, label: 'fact_sales', path: null, parents: [], level: 'Table', models: 1, tables: 1, measures: 1, reports: 2 }],
        report_rows: [
          { id: 'r1', name: 'Regional Sales', status: 'partial', model_name: 'Sales model', sources: 1, measures: 1 },
          { id: 'r2', name: 'Scorecard', status: 'ready', model_name: 'Sales model', sources: 1, measures: 0 },
        ],
    };
    // Focused on r1: only its path (r2 is model-wide on the same table, so it drops out).
    const focused = {
      ...impact, focus: { id: 'r1', kind: 'report', label: 'Regional Sales' }, reports: [impact.reports[0]!],
      edges: impact.edges.filter((e) => e.to !== 'r2'), source_rows: [], report_rows: [],
    };
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => (
      url.includes('focus=') ? { node: schema.id, not_found: false, impact: focused }
        : url.includes('node=') ? { node: schema.id, not_found: false, impact }
          : { tree, total_sources: 3 }) }));
    render(<PowerBiSourceImpactPage />);
    const list = await screen.findByRole('table', { name: 'Tables in gold' });
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-lab/powerbi/sources/impact');
    expect(fetchMock).toHaveBeenCalledWith(`/api/agent-lab/powerbi/sources/impact?node=${encodeURIComponent(schema.id)}`);
    const impactRegion = screen.getByRole('region', { name: 'Impact' });
    expect(within(impactRegion).getByRole('heading', { name: 'gold Schema' })).toBeInTheDocument();
    const totals = within(impactRegion).getByLabelText('Totals');
    expect(totals).toHaveTextContent('Table1');
    expect(totals).toHaveTextContent('Semantic models1');
    expect(totals).toHaveTextContent('Reports2');
    const path = screen.getByRole('navigation', { name: 'Source path' });
    fireEvent.click(within(path).getByRole('button', { name: 'prod' }));
    expect(replace).toHaveBeenCalledWith(`/agent-lab/estate/powerbi/source-impact?node=${encodeURIComponent(tree[2]!.id)}`, { scroll: false });
    fireEvent.click(within(list).getByRole('button', { name: 'fact_sales' }));
    expect(replace).toHaveBeenLastCalledWith(`/agent-lab/estate/powerbi/source-impact?node=${encodeURIComponent(tree[4]!.id)}`, { scroll: false });

    fireEvent.click(screen.getByRole('tab', { name: 'Reports (2)' }));
    const reports = screen.getByRole('table', { name: 'Affected reports' });
    expect(within(reports).getByText('Regional Sales')).toBeInTheDocument();
    expect(within(reports).getByText('model-wide')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Graph' }));
    const graph = screen.getByRole('group', { name: 'Everything that depends on gold' });
    expect(within(graph).getByText('Model-wide')).toBeInTheDocument();

    // Click a report: only what connects to it.
    fireEvent.click(within(graph).getByRole('button', { name: 'Show only what connects to report Regional Sales' }));
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/agent-lab/powerbi/sources/impact?node=${encodeURIComponent(schema.id)}&focus=r1`);
    expect(await screen.findByRole('status')).toHaveTextContent('Filtered to report Regional Sales');
    expect(within(graph).queryByText('Scorecard')).not.toBeInTheDocument();
    expect(within(graph).getByRole('link', { name: 'Open lineage of Regional Sales' })).toHaveAttribute('href', '/agent-lab/estate/powerbi/reports/r1/lineage');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(within(graph).getByText('Scorecard')).toBeInTheDocument();

    // Groups collapse into one box per semantic model and expand back.
    fireEvent.click(within(graph).getByRole('button', { name: 'Collapse Sales model in reports' }));
    expect(within(graph).queryByText('Scorecard')).not.toBeInTheDocument();
    const summary = within(graph).getByRole('button', { name: 'Expand Sales model in reports' });
    expect(summary).toHaveTextContent('Sales model2 reports');
    fireEvent.click(summary);
    expect(within(graph).getByText('Scorecard')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse groups' }));
    expect(within(graph).getByRole('button', { name: 'Expand Sales model in model tables' })).toHaveTextContent('1 model table');
    fireEvent.click(screen.getByRole('button', { name: 'Expand groups' }));
    expect(within(graph).getByText('Revenue')).toBeInTheDocument();

    // From the Reports tab, a report name traces it in the graph.
    fireEvent.click(screen.getByRole('tab', { name: 'Reports (2)' }));
    fireEvent.click(within(screen.getByRole('table', { name: 'Affected reports' })).getByRole('button', { name: /Scorecard/ }));
    expect(screen.getByRole('tab', { name: 'Graph' })).toHaveAttribute('aria-selected', 'true');
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/agent-lab/powerbi/sources/impact?node=${encodeURIComponent(schema.id)}&focus=r2`);
  });

  it('pages long lists of children in the tree', async () => {
    const schema = tree[3]!;
    const many = Array.from({ length: 60 }, (_, i) => node({
      id: id('databricks', 'adb-1', 'prod', 'gold', `tbl_${i}`), parent: schema.id, label: `tbl_${i}`, level: 'Table', depth: 4, leaf: true, sources: 1,
    }));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tree: [...tree.slice(0, 4), ...many], total_sources: 60 }) });
    render(<PowerBiSourceImpactPage />);
    await screen.findByRole('region', { name: 'Source systems' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sources' }), { target: { value: 'tbl_' } });
    const treeEl = screen.getByRole('tree', { name: 'Source hierarchy' });
    expect(within(treeEl).getByText('tbl_49')).toBeInTheDocument();
    expect(within(treeEl).queryByText('tbl_50')).not.toBeInTheDocument();
    expect(within(treeEl).getByText('Schema · 2 tables')).toBeInTheDocument();
    fireEvent.click(within(treeEl).getByRole('button', { name: 'Show more (10)' }));
    expect(within(treeEl).getByText('tbl_59')).toBeInTheDocument();
  });

  it('groups a catalog by schema with collapsible rows, or shows a flat list', async () => {
    const catalog = tree[2]!;
    const gold = tree[3]!;
    const silver = node({ id: id('databricks', 'adb-1', 'prod', 'silver'), parent: catalog.id, label: 'silver', level: 'Schema', depth: 3, reports: 1, sources: 1 });
    const fullTree = [...tree.slice(0, 5), silver, node({ id: id(silver.id, 'dim_x'), parent: silver.id, label: 'dim_x', level: 'Table', depth: 4, leaf: true }), tree[5]!];
    const parentsOf = (schema: SourceTreeNode) => [{ id: schema.id, level: 'Schema', label: schema.label }];
    search = `node=${encodeURIComponent(catalog.id)}`;
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => (url.includes('node=') ? {
      node: catalog.id, not_found: false,
      impact: {
        scope: { id: catalog.id, level: 'Catalog', label: 'prod', leaf: false, system: 'databricks', system_label: 'Databricks', cls: 'warehouse' },
        breadcrumb: tree.slice(0, 3).map((n) => ({ id: n.id, level: n.level, label: n.label })),
        leaf_level: 'Table',
        totals: { sources: 2, leaves: 2, tables: 2, measures: 2, reports: 3, models: 2 },
        focus: null,
        sources: [], hidden_sources: 0, tables: [], hidden_tables: 0, measures: [], hidden_measures: 0, reports: [], hidden_reports: 0, edges: [],
        source_rows: [
          { id: tree[4]!.id, label: 'fact_sales', path: 'gold', parents: parentsOf(gold), level: 'Table', models: 1, tables: 1, measures: 1, reports: 2 },
          { id: id(silver.id, 'dim_x'), label: 'dim_x', path: 'silver', parents: parentsOf(silver), level: 'Table', models: 1, tables: 1, measures: 1, reports: 1 },
        ],
        report_rows: [],
      },
    } : { tree: fullTree, total_sources: 3 }) }));
    render(<PowerBiSourceImpactPage />);
    const list = await screen.findByRole('table', { name: 'Tables in prod' });
    // two schemas → collapsed, each with its own totals from the tree
    const goldToggle = within(list).getByRole('button', { name: 'Expand schema gold' });
    expect(goldToggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(list).getByRole('button', { name: 'Expand schema silver' })).toBeInTheDocument();
    expect(within(list).queryByText('fact_sales')).not.toBeInTheDocument();
    await waitFor(() => expect(within(list).getByText('2 tables')).toBeInTheDocument());

    fireEvent.click(goldToggle);
    expect(within(list).getByRole('button', { name: 'fact_sales' })).toBeInTheDocument();
    expect(within(list).queryByText('dim_x')).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Collapse schema gold' }));
    expect(within(list).queryByText('fact_sales')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(within(list).getByText('fact_sales')).toBeInTheDocument();
    expect(within(list).getByText('dim_x')).toBeInTheDocument();

    fireEvent.click(within(list).getByRole('button', { name: 'Open schema silver' }));
    expect(replace).toHaveBeenLastCalledWith(`/agent-lab/estate/powerbi/source-impact?node=${encodeURIComponent(silver.id)}`, { scroll: false });

    fireEvent.click(screen.getByRole('button', { name: 'Flat list' }));
    expect(within(list).queryByRole('button', { name: /schema gold/ })).not.toBeInTheDocument();
    expect(within(list).getByText('gold')).toBeInTheDocument(); // the schema shows under each table instead
    expect(screen.getByRole('button', { name: 'By schema' })).toHaveAttribute('aria-pressed', 'false');
  });
});

