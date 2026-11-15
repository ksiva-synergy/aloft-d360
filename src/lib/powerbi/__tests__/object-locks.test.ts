import { describe, expect, it } from 'vitest';

import { runWithObjectLocks, warehouseObjectsOf } from '@/lib/powerbi/object-locks';

describe('parallel Compare without contention on one warehouse object', () => {
  it('reads the objects a statement queries', () => {
    expect(
      warehouseObjectsOf('WITH t1 AS (SELECT * FROM (select * From reporting_layer.MMS.pms_defects_qhse) s) SELECT 1 FROM t1 JOIN `c`.`s`.`dim` d ON 1=1'),
    ).toEqual(['reporting_layer.mms.pms_defects_qhse', 'c.s.dim']);
  });

  it('never runs two items sharing an object at once; others run in parallel', async () => {
    const items = [
      { id: 'a1', objs: ['view.a'] },
      { id: 'a2', objs: ['view.a'] },
      { id: 'b1', objs: ['view.b'] },
      { id: 'ab', objs: ['view.a', 'view.b'] },
      { id: 'c1', objs: ['view.c'] },
      { id: 'a3', objs: ['view.a'] },
    ];
    const active = new Map<string, number>();
    let maxParallel = 0;
    let inFlight = 0;
    const done: string[] = [];
    await runWithObjectLocks(items, (i) => i.objs, 4, async (i) => {
      for (const o of i.objs) {
        expect(active.get(o) ?? 0).toBe(0);
        active.set(o, 1);
      }
      inFlight += 1;
      maxParallel = Math.max(maxParallel, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      for (const o of i.objs) active.set(o, 0);
      done.push(i.id);
    });
    expect(done.sort()).toEqual(['a1', 'a2', 'a3', 'ab', 'b1', 'c1']);
    expect(maxParallel).toBeGreaterThan(1);
  });
});
