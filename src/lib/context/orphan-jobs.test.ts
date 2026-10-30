import { describe, expect, it } from 'vitest';
import { jobScopeHasWorker } from './orphan-jobs';

describe('orphan-jobs', () => {
  it('jobScopeHasWorker is false without fargate_task_id', () => {
    expect(jobScopeHasWorker(null)).toBe(false);
    expect(jobScopeHasWorker({})).toBe(false);
    expect(jobScopeHasWorker({ fargate_task_id: '' })).toBe(false);
    expect(jobScopeHasWorker({ fargate_task_id: 'abc123' })).toBe(true);
    expect(jobScopeHasWorker({ fargate_task_id: 'local-12345' })).toBe(true);
  });
});
