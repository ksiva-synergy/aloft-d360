// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';
import PowerBiReportLineageHubPage from './powerbi-report-lineage-hub';
import { ReportLineageExplorer } from '@/components/estate/ReportLineageExplorer';
import { describeReportTableSource } from '@/lib/powerbi/report-lineage-sources';

vi.mock('@/lib/estate/useEstatePipelineAccess', () => ({ useCanRunEstatePipeline: vi.fn(() => true) }));
vi.mock('@/lib/navigation/link', () => ({ default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('all-reports lineage UI', () => {
  const fetchMock = vi.fn();
  const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
  const coverageResponse = {
    coverage: { reports: 120, definitions: 110, parsed_reports: 105, models: 15, parsed_models: 14,
      missing_models: 1, warehouse_tables: 60, unresolved_tables: 3, non_warehouse_tables: 2 },
    latest_job: null, snapshots: { saved: 100, statuses: { ready: 97, blocked: 2, partial: 1 } },
    estate: { classes: { warehouse: 40, database: 8, file: 6, model: 3, unknown: 2 }, questions: { file: 5, unbound: 3, unknown: 2, blocked: 2 } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(useCanRunEstatePipeline).mockReturnValue(true);
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ jobs_enqueued: 1 });
      if (url.includes('coverage=true')) return response(coverageResponse);
      return response({ reports: [], total: 0, offset: 0 });
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  const lineage = {
    report: { id: 'report', name: 'Report', pbi_report_id: 'pbi-report', model_id: 'model', model_name: 'Model' },
    harvest: { page_count: 1, measure_count: 0, has_definition_on_disk: true, from_props_count: 0, from_disk_count: 0 },
    measures: [], uc_paths: [], warnings: [], source_connections: [], sources: [],
  };
  const sourceNode = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-node-id^="s:"]')!;

  it('shows full file locations and sheets when no UC mapping exists', async () => {
    const source = describeReportTableSource('Budget', 'let S = Excel.Workbook(File.Contents("C:\\exports\\budget.xlsx"), null, true), T = S{[Item="Forecast",Kind="Sheet"]}[Data] in T', null);
    fetchMock.mockResolvedValue(response({ lineage: { ...lineage, sources: [source] } }));
    const { container } = render(<ReportLineageExplorer reportId="report" />);
    await screen.findByRole('group', { name: /Lineage from original sources/ });
    expect(screen.getAllByText('model-wide').length).toBeGreaterThan(0);
    fireEvent.click(sourceNode(container));
    expect(screen.getByText('C:\\exports\\budget.xlsx')).toBeInTheDocument();
    expect(screen.getByText('Forecast (Sheet)')).toBeInTheDocument();
  });

  it('shows Fabric navigation identifiers without requiring UC', async () => {
    const source = describeReportTableSource('Orders', 'let S = Lakehouse.Contents(null), W = S{[workspaceId="workspace-id"]}[Data], L = W{[lakehouseId="lakehouse-id"]}[Data] in L', null);
    fetchMock.mockResolvedValue(response({ lineage: { ...lineage, sources: [source] } }));
    const { container } = render(<ReportLineageExplorer reportId="report" />);
    await screen.findByRole('group', { name: /Lineage from original sources/ });
    fireEvent.click(sourceNode(container));
    expect(screen.getByText('Microsoft Fabric source')).toBeInTheDocument();
    expect(screen.getByText('workspaceId=workspace-id')).toBeInTheDocument();
    expect(screen.getByText('lakehouseId=lakehouse-id')).toBeInTheDocument();
  });

  it('shows inventory-only connections when table definitions have not been parsed', async () => {
    fetchMock.mockResolvedValue(response({ lineage: { ...lineage, source_connections: [{
      type: 'Sql', server: 'server.example.test', database: 'Finance', path: null, details: {}, gateway_id: null, datasource_id: null,
    }] } }));
    render(<ReportLineageExplorer reportId="report" />);
    expect(await screen.findByText('server.example.test')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('No parsed table-source details available.')).toBeInTheDocument();
  });

  it('explains partial lineage, traces a measure and lists rows in the table lens', async () => {
    const sales = { ...describeReportTableSource('Sales', 'let S = Sql.Database("sqlprod01", "Planning"), T = S{[Schema="dbo",Item="Sales"]}[Data] in T', null), referenced_by_measures: ['Revenue'] };
    sales.partition_kind = 'warehouse_query';
    fetchMock.mockResolvedValue(response({
      lineage: { ...lineage, sources: [sales], measures: [
        { name: 'Revenue', found_in_model: true, measure_table: 'Sales', tables_involved: ['Sales'], uc_paths: [], sources: [sales] },
        { name: 'Ghost', found_in_model: false, measure_table: null, tables_involved: [], uc_paths: [], sources: [] },
      ] },
      snapshot: { status: 'partial', generated_at: '2026-11-16T10:00:00.000Z', run_id: 'run-1' },
    }));
    const { container } = render(<ReportLineageExplorer reportId="report" />);
    const checklist = await screen.findByRole('list', { name: 'Readiness checklist' });
    expect(within(checklist).getByText('1 measure not found on the model')).toBeInTheDocument();
    expect(within(checklist).getByText('1 warehouse table not mapped to Unity Catalog')).toBeInTheDocument();
    expect(screen.getByText('run-1')).toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-node-id="m:revenue"]')!);
    expect(screen.getByRole('button', { name: 'Back to readiness' })).toBeInTheDocument();
    expect(container.querySelector('[data-lane-node="t:sales"]')).toHaveAttribute('data-hot', 'true');
    expect(container.querySelector('[data-lane-node="m:ghost"]')).not.toHaveAttribute('data-hot');

    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.getByText('2 of 2 rows')).toBeInTheDocument();
  });

  it('shows coverage and persisted snapshot counts independently of search results', async () => {
    render(<PowerBiReportLineageHubPage />);
    expect(await screen.findByText('110 / 120')).toBeInTheDocument();
    expect(screen.getByText(/Stored snapshots: 100 \/ 120/)).toBeInTheDocument();
    expect(screen.getByText('1 report without an active model')).toBeInTheDocument();
  });

  it('filters reports by a saved question and shows snapshot facts per row', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('coverage=true')) return response(coverageResponse);
      return response({ total: 1, offset: 0, reports: [{
        id: 'r1', name: 'Regional Sales', model_name: 'Sales', measure_count: 8, page_count: 6,
        snapshot: { status: 'partial', generated_at: '2026-11-16T10:00:00.000Z', warning_count: 2, tables: 5,
          mix: { warehouse: 2, database: 1, file: 1, model: 0, unknown: 1 }, uc_bound: 2, uc_candidates: 3 },
      }] });
    });
    render(<PowerBiReportLineageHubPage />);
    expect(await screen.findByText('Regional Sales')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reads Excel, CSV, SharePoint or web files/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('filter=file')));
  });

  it('confirms the whole-estate scope and submits only the server-enforced lineage action', async () => {
    render(<PowerBiReportLineageHubPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run lineage for all reports' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByText('All accessible workspaces, reports and semantic models')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run all reports' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-lab/context/jobs/launch', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ pbiAllReports: true, uiSurface: 'estate.powerbi.report-lineage.all' }),
    }));
  });

  it('keeps coverage visible but hides launch controls from non-operators', async () => {
    vi.mocked(useCanRunEstatePipeline).mockReturnValue(false);
    render(<PowerBiReportLineageHubPage />);
    expect(await screen.findByText('110 / 120')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run lineage for all reports' })).not.toBeInTheDocument();
  });

  it('reports launch failures and leaves the dialog available for retry', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === 'POST'
      ? response({ message: 'A pipeline is already running' }, false)
      : response(url.includes('coverage=true') ? { coverage: null, latest_job: null, snapshots: null } : { reports: [], total: 0 }));
    render(<PowerBiReportLineageHubPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run lineage for all reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run all reports' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not start lineage pipeline', { description: 'A pipeline is already running' }));
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});
