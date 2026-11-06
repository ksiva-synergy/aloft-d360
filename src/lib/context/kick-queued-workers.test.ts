import { describe, expect, it } from 'vitest';
import { isOrphanedQueuedJob } from './kick-queued-workers';

describe('isOrphanedQueuedJob', () => {
  const now = Date.parse('2026-10-27T17:00:00.000Z');

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
});
