import { describe, expect, it } from 'vitest';
import { displayDepartmentName, resolveObjectDepartmentKey } from '../welcome-departments';

describe('resolveObjectDepartmentKey', () => {
  const depts = [
    { key: 'crewing', name: 'CREWING', paths: ['curated_db.db_smac_prod_navitasai_crewing_public'] },
    { key: 'marine', name: 'Marine', paths: ['curated_db.addressable_market'] },
  ];

  it('prefers the longest matching department path', () => {
    expect(
      resolveObjectDepartmentKey(
        'curated_db.db_smac_prod_navitasai_crewing_public.seafarers',
        depts,
      ),
    ).toBe('crewing');
  });

  it('falls back to finance from schema name', () => {
    expect(resolveObjectDepartmentKey('open_analytics_zone.finance.budget', depts)).toBe('finance');
  });

  it('falls back to qhse from schema name', () => {
    expect(resolveObjectDepartmentKey('reporting_layer.qhse.incidents', depts)).toBe('qhse');
  });
});

describe('displayDepartmentName', () => {
  it('title-cases configured names', () => {
    expect(displayDepartmentName('crewing', 'CREWING')).toBe('Crewing');
    expect(displayDepartmentName('technical', 'TECHNICAL')).toBe('Technical');
  });
});
