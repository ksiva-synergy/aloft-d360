import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPbiInventory } from '@/lib/powerbi/inventory';
import { listDatasets, listReports, listWorkspaces } from '@/lib/powerbi/client';
import prisma from '@/lib/db';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ default: {
  platformContextSource: { findFirst: vi.fn() },
  pbiWorkspace: { upsert: vi.fn() },
} }));
vi.mock('@/lib/powerbi/client', () => ({
  PowerBiApiError: class extends Error {},
  listWorkspaces: vi.fn(), listDatasets: vi.fn(), listReports: vi.fn(), listDatasetDatasources: vi.fn(),
}));

describe('estate-wide Power BI inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.platformContextSource.findFirst).mockResolvedValue({ scope_include: ['w1'] } as never);
    vi.mocked(prisma.pbiWorkspace.upsert).mockResolvedValue({ id: 'workspace' } as never);
    vi.mocked(listWorkspaces).mockResolvedValue([{ id: 'w1', name: 'One' }, { id: 'w2', name: 'Two' }] as never);
    vi.mocked(listDatasets).mockResolvedValue([]);
    vi.mocked(listReports).mockResolvedValue([]);
  });

  it('retains the configured workspace filter for normal runs', async () => {
    expect((await runPbiInventory('org', 'source', { runId: 'run' })).workspaces).toBe(1);
    expect(listReports).toHaveBeenCalledTimes(1);
  });

  it('visits every accessible workspace for an explicit all-reports run', async () => {
    expect((await runPbiInventory('org', 'source', { runId: 'run', allWorkspaces: true })).workspaces).toBe(2);
    expect(listReports).toHaveBeenCalledWith('w2');
  });
});