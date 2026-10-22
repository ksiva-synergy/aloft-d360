import { describe, expect, it } from 'vitest';
import { selectDroppedPaths } from './scope-match';

describe('selectDroppedPaths', () => {
  const active = [
    'open_analytics_zone.qhse.tokyo_mou',
    'open_analytics_zone.qhse.gone_table',
    'open_analytics_zone.rs_navtor.vw_corrective_action',
    'landing_zone_dev.sire_2_0.sire_report',
    'reporting_layer.qhse.bi_synergypool_vw_sire_2_0',
  ];

  it('never drops objects outside the sweep scope after scope is narrowed', () => {
    const dropped = selectDroppedPaths({
      activePaths: active,
      resolvedPaths: ['open_analytics_zone.qhse.tokyo_mou', 'open_analytics_zone.rs_navtor.vw_corrective_action'],
      includes: ['open_analytics_zone.*.*'],
      excludes: [],
    });
    expect(dropped).toEqual(['open_analytics_zone.qhse.gone_table']);
  });

  it('does not drop schemas the listing never returned (truncated or failed listing)', () => {
    const dropped = selectDroppedPaths({
      activePaths: active,
      resolvedPaths: ['open_analytics_zone.qhse.tokyo_mou', 'open_analytics_zone.qhse.gone_table'],
      includes: ['*.*.*'],
      excludes: [],
    });
    expect(dropped).toEqual([]);
  });

  it('drops nothing when the listing is empty', () => {
    expect(selectDroppedPaths({ activePaths: active, resolvedPaths: [], includes: ['*.*.*'], excludes: [] })).toEqual([]);
  });

  it('respects excludes', () => {
    const dropped = selectDroppedPaths({
      activePaths: active,
      resolvedPaths: ['open_analytics_zone.qhse.tokyo_mou'],
      includes: ['*.*.*'],
      excludes: ['*.qhse.gone_*'],
    });
    expect(dropped).toEqual([]);
  });
});
