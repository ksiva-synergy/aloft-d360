import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeCostUsd } from '@/lib/lifecycle/log-agent-cost';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    platformSpendEvent: { create: vi.fn() },
    platformContextJob: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';
import { recordSpendEvent, recordHarvestJobSpend } from '@/lib/spend/record-spend-event';

describe('recordSpendEvent', () => {
  beforeEach(() => {
    vi.mocked(prisma.platformSpendEvent.create).mockReset();
    vi.mocked(prisma.platformSpendEvent.create).mockResolvedValue({} as never);
  });

  it('computes usd from model when usd omitted', async () => {
    await recordSpendEvent({
      orgId: 'org-1',
      bucket: 'interactive',
      surface: 'inspector',
      action: 'turn',
      model: 'claude-sonnet-4',
      inputTokens: 1000,
      outputTokens: 200,
      referenceType: 'agent_turn',
      referenceId: 'turn-1',
    });
    expect(prisma.platformSpendEvent.create).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.platformSpendEvent.create).mock.calls[0]![0].data;
    expect(Number(data.usd)).toBeCloseTo(
      computeCostUsd('claude-sonnet-4', 1000, 200),
      6,
    );
  });

  it('skips zero-cost zero-token events', async () => {
    await recordSpendEvent({
      orgId: 'org-1',
      bucket: 'interactive',
      surface: 'x',
      action: 'turn',
      usd: 0,
      inputTokens: 0,
      outputTokens: 0,
      referenceType: 'x',
      referenceId: 'y',
    });
    expect(prisma.platformSpendEvent.create).not.toHaveBeenCalled();
  });
});

describe('recordHarvestJobSpend', () => {
  beforeEach(() => {
    vi.mocked(prisma.platformContextJob.findUnique).mockReset();
    vi.mocked(prisma.platformSpendEvent.create).mockReset();
    vi.mocked(prisma.platformSpendEvent.create).mockResolvedValue({} as never);
  });

  it('writes harvest bucket when job has cost_usd', async () => {
    vi.mocked(prisma.platformContextJob.findUnique).mockResolvedValue({
      id: 'job-1',
      org_id: 'org-1',
      job_kind: 't2_semantic',
      source_id: null,
      status: 'succeeded',
      stats: { cost_usd: 1.25, objects_enriched: 10 },
      finished_at: new Date('2026-01-01'),
      triggered_by_user_id: 'user-1',
      error: null,
    } as never);

    await recordHarvestJobSpend('job-1');

    expect(prisma.platformSpendEvent.create).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.platformSpendEvent.create).mock.calls[0]![0].data;
    expect(data.bucket).toBe('harvest');
    expect(Number(data.usd)).toBe(1.25);
    expect(data.user_id).toBe('user-1');
  });
});
