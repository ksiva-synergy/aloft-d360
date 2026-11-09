import { describe, expect, it } from 'vitest';
import { friendlyDataLabel, parseQueryPathsParam, requestUrlForAccess, scopeSummaryForPath, tableDenialMessage } from '../denial-ui';

describe('denial-ui', () => {
  it('builds request URLs', () => {
    expect(requestUrlForAccess({ path: 'main.hr.employee' })).toBe('/my-access?path=main.hr.employee');
    expect(requestUrlForAccess({ tagId: 'comp' })).toBe('/my-access?tag=comp');
    expect(requestUrlForAccess({})).toBe('/my-access');
    expect(requestUrlForAccess({ path: 'a.b.c', label: 'employee records', level: 'query' })).toContain('label=employee');
    expect(requestUrlForAccess({ path: 'a.b.c', queryPaths: ['a.b.c', 'a.b.payroll'] })).toContain('qp=a.b.c%2Ca.b.payroll');
    expect(requestUrlForAccess({ path: 'a.b.c', queryPaths: ['a.b.c'] })).toContain('quick=1');
  });

  it('parseQueryPathsParam reads qp', () => {
    expect(parseQueryPathsParam('A.B.T,a.b.u')).toEqual(['a.b.t', 'a.b.u']);
  });

  it('scopeSummaryForPath explains coverage', () => {
    expect(scopeSummaryForPath('cat.schema.table').depth).toBe(3);
    expect(scopeSummaryForPath('cat').summary).toMatch(/catalog/i);
  });

  it('does not sound like missing data or expose warehouse paths', () => {
    const m = tableDenialMessage('darwin_box.curated_db.employee_master_ranked_by_id', 'no_grant', []);
    expect(m).toMatch(/don't have access/i);
    expect(m).not.toMatch(/not found/i);
    expect(m).toMatch(/employee records/i);
    expect(m).not.toMatch(/darwin_box|curated_db|employee_master_ranked_by_id/);
  });

  it('friendlyDataLabel humanizes table leaf', () => {
    expect(friendlyDataLabel('a.b.payroll_run')).toBe('payroll run data');
  });
});
