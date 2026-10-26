import { describe, expect, it } from 'vitest';
import {
  formatStatsSummary,
  isEmptySuccessJob,
  launchUsesEstateExcludeTree,
  resolveDisplayJobStatus,
  resolveLaunchScopeFilters,
  stripExcludeSchemasForKind,
  t0AllowsLiveScopeWhenDiscoveryEmpty,
} from './job-ui';

describe('job-ui', () => {
  it('t0AllowsLiveScopeWhenDiscoveryEmpty for Limit-only T0', () => {
    expect(t0AllowsLiveScopeWhenDiscoveryEmpty('t0_structural', ['curated_db.foo.*'], 0)).toBe(true);
    expect(t0AllowsLiveScopeWhenDiscoveryEmpty('t0_structural', [], 0)).toBe(false);
    expect(t0AllowsLiveScopeWhenDiscoveryEmpty('t1_profile', ['x'], 0)).toBe(false);
  });

  it('t0AllowsLiveScopeWhenDiscoveryEmpty for narrowed exclude-only T0', () => {
    expect(
      t0AllowsLiveScopeWhenDiscoveryEmpty('t0_structural', [], 0, { total: 50, excluded: 49 }),
    ).toBe(true);
    expect(
      t0AllowsLiveScopeWhenDiscoveryEmpty('t0_structural', [], 0, { total: 10, excluded: 10 }),
    ).toBe(false);
  });

  it('resolveLaunchScopeFilters prefers Limit over excludes', () => {
    expect(
      resolveLaunchScopeFilters(['a.b'], ['curated_db.foo.*']),
    ).toEqual({ excludeSchemas: [], includePatterns: ['curated_db.foo.*'] });
    expect(resolveLaunchScopeFilters(['a.b'], [])).toEqual({
      excludeSchemas: ['a.b'],
      includePatterns: [],
    });
  });

  it('shows exclude tree for T1/T2-only launch', () => {
    expect(launchUsesEstateExcludeTree(['t1_profile', 't2_semantic'])).toBe(true);
    expect(launchUsesEstateExcludeTree(['t0_structural', 't1_profile'])).toBe(true);
    expect(launchUsesEstateExcludeTree(['embed'])).toBe(false);
  });

  it('passes exclude schemas through for all kinds', () => {
    expect(stripExcludeSchemasForKind('t1_profile', ['a.b'])).toEqual(['a.b']);
    expect(stripExcludeSchemasForKind('t0_structural', ['a.b'])).toEqual(['a.b']);
  });

  it('flags empty T1 success', () => {
    expect(isEmptySuccessJob('succeeded', { objects_profiled: 0 }, 't1_profile')).toBe(true);
    expect(resolveDisplayJobStatus('succeeded', { objects_profiled: 0 }, 't1_profile')).toBe('empty');
    expect(formatStatsSummary({ objects_profiled: 0 }, 't1_profile')).toContain('no work');
  });
});
