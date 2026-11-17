import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOrphanedQueuedJob } from './kick-queued-workers';

vi.mock('./launch-harvester', () => ({
  isLocalHarvestRuntime: vi.fn(() => true),
  launchHarvesterTask: vi.fn(),
}));

import { isLocalHarvestRuntime } from './launch-harvester';

describe('isOrphanedQueuedJob', () => {
  const now = Date.parse('2026-10-27T17:00:00.000Z');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a job that is still inside the launch window', () => {
    expect(isOrphanedQueuedJob({
      created_at: new Date('2026-10-27T16:59:50.000Z'),
      scope: {},
    }, now)).toBe(false);
  });

  it('treats an old job with no task id as orphaned', () => {
    expect(isOrphanedQueuedJob({
      created_at: new Date('2026-10-27T16:50:00.000Z'),
      scope: { chain: ['t2_semantic'], includePatterns: ['c.s.*'] },
    }, now)).toBe(true);
  });

  it('skips a job that already has a worker id', () => {
    expect(isOrphanedQueuedJob({
      created_at: new Date('2026-10-27T16:50:00.000Z'),
      scope: { fargate_task_id: 'abc' },
    }, now)).toBe(false);
  });

  const localJob = {
    created_at: new Date('2026-10-27T16:50:00.000Z'),
    scope: { fargate_task_id: 'local-32992' },
  };

  it('recovers a queued job whose local worker no longer exists', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('not found'), { code: 'ESRCH' });
    });
    expect(isOrphanedQueuedJob(localJob, now)).toBe(true);
    expect(kill).toHaveBeenCalledWith(32992, 0);
  });

  it('keeps a live local worker', () => {
    vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(isOrphanedQueuedJob(localJob, now)).toBe(false);
  });

  it('does not retry when process access is denied', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    });
    expect(isOrphanedQueuedJob(localJob, now)).toBe(false);
  });

  it('does not probe local process ids in ECS runtime', () => {
    vi.mocked(isLocalHarvestRuntime).mockReturnValueOnce(false);
    const kill = vi.spyOn(process, 'kill');
    expect(isOrphanedQueuedJob(localJob, now)).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it('does not probe a worker inside the launch window', () => {
    const kill = vi.spyOn(process, 'kill');
    expect(isOrphanedQueuedJob({ ...localJob, created_at: new Date(now - 1_000) }, now)).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});
