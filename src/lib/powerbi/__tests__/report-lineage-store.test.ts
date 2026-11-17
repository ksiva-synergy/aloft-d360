import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/db';
import { buildReportLineage } from '@/lib/powerbi/report-lineage-build';
import { persistReportLineage } from '@/lib/powerbi/report-lineage-store';
import { describeReportTableSource } from '@/lib/powerbi/report-lineage-sources';

vi.mock('@/lib/db', () => ({ default: {
  pbiReport: { findMany: vi.fn() }, pbiReportLineage: { upsert: vi.fn() },
} }));
vi.mock('@/lib/powerbi/report-lineage-build', () => ({ buildReportLineage: vi.fn() }));

describe('persistReportLineage', () => {
  const props = {
    definition: { storage_path: 'report', content_hash: 'hash' },
    parse: { parsed_at: '2026-11-16', definition_hash: 'hash', measure_refs: [] },
  };
  const report = {
    id: 'r1', name: 'Report', pbi_report_id: 'pbi-r1', model_id: 'm1', props,
    model: { id: 'm1', lifecycle: 'active', props, tables: [] },
  };
  const payload = {
    report: { id: 'r1', name: 'Report', pbi_report_id: 'pbi-r1', model_id: 'm1', model_name: 'Model' },
    harvest: { page_count: 1, measure_count: 0, has_definition_on_disk: true, from_props_count: 0, from_disk_count: 0 },
    measures: [], sources: [describeReportTableSource('Budget', 'let S = File.Contents("C:\\exports\\budget.csv") in S', null)],
    source_connections: [], uc_paths: ['c.s.t'], warnings: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.pbiReport.findMany).mockResolvedValue([report] as never);
    vi.mocked(prisma.pbiReportLineage.upsert).mockResolvedValue({} as never);
    vi.mocked(buildReportLineage).mockResolvedValue(payload);
  });

  it('upserts the UI payload, paths, and producing run without duplicating reports', async () => {
    expect(await persistReportLineage('org', { runId: 'run' })).toEqual({ saved: 1, ready: 1, partial: 0, blocked: 0, failed: 0 });
    expect(prisma.pbiReportLineage.upsert).toHaveBeenCalledWith({
      where: { report_id: 'r1' },
      create: expect.objectContaining({ org_id: 'org', report_id: 'r1', run_id: 'run', status: 'ready', lineage: payload, uc_paths: ['c.s.t'] }),
      update: expect.objectContaining({ run_id: 'run', lineage: payload }),
    });
  });

  it('persists missing-model gaps instead of omitting reports', async () => {
    vi.mocked(buildReportLineage).mockResolvedValue(null);
    expect((await persistReportLineage('org', { runId: 'run' })).blocked).toBe(1);
    expect(prisma.pbiReportLineage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'blocked', warnings: [expect.stringContaining('no active')] }),
    }));
  });

  it('stores unknown original sources as partial, not ready', async () => {
    vi.mocked(buildReportLineage).mockResolvedValue({ ...payload, sources: [describeReportTableSource('Unknown', null, null)] });
    expect((await persistReportLineage('org', { runId: 'run' })).partial).toBe(1);
    expect(prisma.pbiReportLineage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'partial', warnings: [expect.stringContaining('Original source is unknown')] }),
    }));
  });

  it('marks unresolved measure names partial', async () => {
    vi.mocked(buildReportLineage).mockResolvedValue({ ...payload, measures: [{
      name: 'Missing', found_in_model: false, measure_table: null, tables_involved: [], uc_paths: [], sources: [],
    }] });
    expect((await persistReportLineage('org', { runId: 'run' })).partial).toBe(1);
  });

  it('stores failed resolutions and continues to the next report', async () => {
    vi.mocked(prisma.pbiReport.findMany).mockResolvedValue([report, { ...report, id: 'r2' }] as never);
    vi.mocked(buildReportLineage).mockRejectedValueOnce(new Error('resolution failed'));
    const stats = await persistReportLineage('org', { runId: 'run', modelIds: ['pbi-m1'] });
    expect(stats).toMatchObject({ saved: 2, failed: 1, ready: 1 });
    expect(prisma.pbiReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ org_id: 'org', lifecycle: 'active', model: { pbi_model_id: { in: ['pbi-m1'] } } }),
    }));
  });

  it('does not conceal a failed database write', async () => {
    vi.mocked(prisma.pbiReportLineage.upsert).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(persistReportLineage('org', { runId: 'run' })).rejects.toThrow('database unavailable');
  });
});