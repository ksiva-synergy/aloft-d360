import { describe, expect, it } from 'vitest';

import { STALE_MAX_REFRESHES, decideFreshness, describeDrift, tableDrift } from '@/lib/powerbi/freshness';

const drifted = tableDrift({
  table: 'IMO_Master_List',
  powerBi: { rows: 1591151, maxDates: { Updated: '2026-11-15T01:00:00Z' } },
  warehouse: { rows: '1592500', maxDates: { Updated: '2026-11-15T19:00:00Z' } },
});
const same = tableDrift({ table: 'Audit', powerBi: { rows: 5540, maxDates: { D: '2026-11-14' } }, warehouse: { rows: 5540, maxDates: { D: '2026-11-14' } } });

describe('data freshness in parity', () => {
  it('measures drift from row counts and newer dates (aggregates only)', () => {
    expect(drifted).toMatchObject({ drifted: true, power_bi_rows: 1591151, warehouse_rows: 1592500 });
    expect(drifted.newer_dates.map((d) => d.column)).toEqual(['Updated']);
    expect(same.drifted).toBe(false);
    expect(describeDrift([drifted])).toBe('IMO_Master_List: +1,349 rows in the warehouse (1,591,151 → 1,592,500), newer Updated (2026-11-15 vs 2026-11-15)');
  });

  it('a mismatch without drift is a real failure', () => {
    expect(decideFreshness({ drift: [same], prior: null, refreshAt: 'r1', now: 't' }).verdict).toBe('fail');
  });

  it('a mismatch with drift is stale, re-checked after refreshes, and fails if it keeps differing', () => {
    const first = decideFreshness({ drift: [drifted], prior: null, refreshAt: '2026-11-15T02:38:00Z', now: 'n1' });
    expect(first.verdict).toBe('stale');
    if (first.verdict !== 'stale') return;
    expect(first.stale).toMatchObject({ since: 'n1', refreshes: ['2026-11-15T02:38:00Z'] });

    // same refresh, checked again: still stale
    const again = decideFreshness({ drift: [drifted], prior: first.stale, refreshAt: '2026-11-15T02:38:00Z', now: 'n2' });
    expect(again.verdict).toBe('stale');

    // after STALE_MAX_REFRESHES newer refreshes it still differs → not freshness
    let prior = first.stale;
    for (let i = 1; i <= STALE_MAX_REFRESHES; i++) {
      const r = decideFreshness({ drift: [drifted], prior, refreshAt: `2026-11-1${5 + i}T02:38:00Z`, now: `n${i}` });
      if (i < STALE_MAX_REFRESHES) {
        expect(r.verdict).toBe('stale');
        if (r.verdict === 'stale') prior = r.stale;
      } else {
        expect(r.verdict).toBe('fail');
        expect(r.summary).toMatch(/Still differs after 2 dataset refreshes/);
      }
    }
  });
});

describe('dates from the Power BI Arrow API', () => {
  it('epoch seconds are dates, and a missing Power BI date is not evidence', () => {
    const epoch = tableDrift({
      table: 'Approval_Log',
      powerBi: { rows: 100, maxDates: { ACTION_DATE: 1794700800, Doc: null } },
      warehouse: { rows: 100, maxDates: { ACTION_DATE: '2026-11-14T00:00:00Z', Doc: '2026-11-06' } },
    });
    expect(epoch.drifted).toBe(false);
    const newer = tableDrift({
      table: 'Approval_Log',
      powerBi: { rows: 100, maxDates: { ACTION_DATE: 1794700800 } },
      warehouse: { rows: 100, maxDates: { ACTION_DATE: '2026-11-15T10:00:00Z' } },
    });
    expect(newer.newer_dates).toEqual([{ column: 'ACTION_DATE', power_bi: '2026-11-15', warehouse: '2026-11-15' }]); // 1794700800 s = 2026-11-15T00:00Z
  });
});
