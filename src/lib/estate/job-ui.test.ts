import { describe, expect, it } from 'vitest';
import {
  formatStatsSummary,
  isEmptySuccessJob,
  launchUsesEstateExcludeTree,
  mapJobStatus,
  resolveDisplayJobStatus,
  resolveLaunchScopeFilters,
  resolveModalLaunchScope,
  stripExcludeSchemasForKind,
  wideScopeTierLaunchBlocked,
  t0AllowsLiveScopeWhenDiscoveryEmpty,
} from './job-ui';

describe('mapJobStatus', () => {
  it('maps cancelled jobs to cancelled, not queued', () => {
    expect(mapJobStatus('cancelled')).toBe('cancelled');
    expect(mapJobStatus('canceled')).toBe('cancelled');
  });

  it('maps partial to done and unknown statuses to queued', () => {
    expect(mapJobStatus('partial')).toBe('done');
    expect(mapJobStatus('something_new')).toBe('queued');
  });
});

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

  it('resolveModalLaunchScope maps include-tree to globs', () => {
    expect(
      resolveModalLaunchScope({
        includePatternsText: '',
        scopeTreeMode: 'include',
        excludeSchemas: [],
        includedSchemas: ['curated_db.foo'],
      }),
    ).toEqual({ excludeSchemas: [], includePatterns: ['curated_db.foo.*'] });
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

  it('wideScopeTierLaunchBlocked requires Limit or opt-in', () => {
    expect(wideScopeTierLaunchBlocked('t2_semantic', ['a.b.*'], 200, false).blocked).toBe(false);
    expect(wideScopeTierLaunchBlocked('t2_semantic', [], 51, false).blocked).toBe(true);
    expect(wideScopeTierLaunchBlocked('t2_semantic', [], 51, true).blocked).toBe(false);
    expect(wideScopeTierLaunchBlocked('t0_structural', [], 999, false).blocked).toBe(false);
  });
});
