import { describe, expect, it } from 'vitest';
import {
  formatStatsSummary,
  isEmptySuccessJob,
  resolveDisplayJobStatus,
  stripExcludeSchemasForKind,
} from './job-ui';

describe('job-ui', () => {
  it('strips exclude schemas for T1/T2', () => {
    expect(stripExcludeSchemasForKind('t1_profile', ['a.b'])).toEqual([]);
    expect(stripExcludeSchemasForKind('t0_structural', ['a.b'])).toEqual(['a.b']);
  });

  it('flags empty T1 success', () => {
    expect(isEmptySuccessJob('succeeded', { objects_profiled: 0 }, 't1_profile')).toBe(true);
    expect(resolveDisplayJobStatus('succeeded', { objects_profiled: 0 }, 't1_profile')).toBe('empty');
    expect(formatStatsSummary({ objects_profiled: 0 }, 't1_profile')).toContain('no work');
  });
});
