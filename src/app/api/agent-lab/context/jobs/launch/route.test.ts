import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';
import { enqueue } from '@/lib/context/queue';
import { launchHarvesterTask } from '@/lib/context/launch-harvester';
import { denyUnlessEstatePipelineOperator } from '@/lib/estate/require-estate-pipeline-operator';
import { resolveLaunchSources } from '@/lib/context/resolve-launch-source';
import { findScopedLaunchConflict } from '@/lib/context/enqueue-and-launch';
import prisma from '@/lib/db';

vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'operator' } })) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db', () => ({ default: { $executeRaw: vi.fn(), pbiReportLineage: { count: vi.fn(async () => 0) } } }));
vi.mock('@/lib/databricks/connections', () => ({ getOrgId: vi.fn(async () => 'org') }));
vi.mock('@/lib/context/queue', () => ({
  enqueue: vi.fn(async () => ({ id: 'job' })), enqueueWithChildren: vi.fn(),
  planForKind: vi.fn(async () => ({ totalObjects: 0 })), launchChildTask: vi.fn(),
  MAX_CONCURRENT_TASKS: 1, MAX_CONCURRENT_BY_KIND: {}, REGION: 'test',
}));
vi.mock('@/lib/context/launch-harvester', () => ({
  isLocalHarvestRuntime: vi.fn(() => true),
  launchHarvesterTask: vi.fn(async () => ({ taskId: 'local-123', taskArn: 'local://123' })),
}));
vi.mock('@/lib/estate/require-estate-pipeline-operator', () => ({ denyUnlessEstatePipelineOperator: vi.fn(async () => null) }));
vi.mock('@/lib/context/resolve-launch-source', () => ({
  resolveLaunchSources: vi.fn(),
  filterSourcesForJobKind: (sources: { connection_kind: string }[], kind: string) => sources.filter((source) =>
    kind.startsWith('pbi_') ? source.connection_kind === 'powerbi' : source.connection_kind !== 'powerbi'),
  LaunchSourceNotFoundError: class extends Error {},
}));
vi.mock('@/lib/context/enqueue-and-launch', () => ({ findScopedLaunchConflict: vi.fn(async () => null) }));
vi.mock('@/lib/context/orphan-jobs', () => ({ failJobsAfterLaunchError: vi.fn() }));
vi.mock('@/lib/context/launch-cost-estimate', () => ({ estimateLaunchHarvestUsd: vi.fn(async () => 0) }));
vi.mock('@/lib/spend/budgets', () => ({ assertHarvestBudget: vi.fn(), BudgetExceededError: class extends Error {} }));

describe('all-reports lineage launch', () => {
  const request = (body: Record<string, unknown> = {}) => new NextRequest('http://localhost/api/agent-lab/context/jobs/launch', {
    method: 'POST', body: JSON.stringify({ pbiAllReports: true, ...body }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLaunchSources).mockResolvedValue([
      { id: 'db', connection_kind: 'databricks', display_name: 'Warehouse' },
      { id: 'pbi', connection_kind: 'powerbi', display_name: 'Power BI' },
      { id: 'pbi2', connection_kind: 'powerbi', display_name: 'Another source' },
    ]);
  });

  it('forces the lineage-only chain and ignores narrower filters and recreation stages', async () => {
    const response = await POST(request({ kinds: ['pbi_translate'], sequential: false, modelIds: ['m1'], reportIds: ['r1'], sourceId: 'db' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kinds: ['pbi_inventory', 'pbi_definitions', 'pbi_parse', 'pbi_catalog_link'], sequential: true, jobs_enqueued: 1,
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith('pbi_inventory', 'pbi', expect.objectContaining({
      all_reports: true, fetch_models: true, fetch_reports: true,
      chain: ['pbi_definitions', 'pbi_parse', 'pbi_catalog_link'], pipeline_run_id: expect.any(String),
    }), 'on_demand', 'org', 'operator');
    expect(launchHarvesterTask).toHaveBeenCalledWith(['--kind', 'pbi_inventory']);
  });

  it('rejects requests without operator permission before doing any work', async () => {
    vi.mocked(denyUnlessEstatePipelineOperator).mockResolvedValueOnce(NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }));
    expect((await POST(request())).status).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('reports a missing Power BI source rather than returning a false success', async () => {
    vi.mocked(resolveLaunchSources).mockResolvedValueOnce([]);
    expect((await POST(request())).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('blocks overlapping runs', async () => {
    vi.mocked(findScopedLaunchConflict).mockResolvedValueOnce({ id: 'active', job_kind: 'pbi_parse' } as never);
    expect((await POST(request())).status).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('requires the storage migration before enqueueing any work', async () => {
    vi.mocked(prisma.pbiReportLineage.count).mockRejectedValueOnce(Object.assign(new Error('missing table'), { code: 'P2021' }));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'LINEAGE_STORAGE_NOT_READY' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});