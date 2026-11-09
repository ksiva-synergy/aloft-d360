import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const { tables, bumpPolicyVersion } = vi.hoisted(() => ({
  tables: { pp: [] as Row[], ct: [] as Row[] },
  bumpPolicyVersion: vi.fn(async () => 2n),
}));

vi.mock('@/lib/db', () => ({
  default: {
    accessPathProtection: {
      findMany: vi.fn(async ({ where }: { where: { path: { in: string[] } } }) => tables.pp.filter((r) => where.path.in.includes(r.path as string))),
      upsert: vi.fn(async ({ create }: { create: Row }) => {
        if (!tables.pp.some((r) => r.tag_id === create.tag_id && r.path === create.path)) tables.pp.push(create);
      }),
    },
    accessColumnTag: {
      findMany: vi.fn(async ({ where }: { where: { table_path: string } }) => tables.ct.filter((r) => r.table_path === where.table_path)),
    },
  },
}));
vi.mock('@/lib/access/policy-store', () => ({ bumpPolicyVersion }));
vi.mock('@/lib/databricks/token-client', () => ({ openDatabricksSession: vi.fn() }));
vi.mock('@/lib/databricks/execute', () => ({ executeDatabricksDDL: vi.fn() }));

import { compileMetricViewDDL, inheritProtectionsForView, metricViewLineage } from '../metric-views';

beforeEach(() => {
  tables.pp = [];
  tables.ct = [];
  bumpPolicyVersion.mockClear();
});

describe('generated views carry their source protections (review C5)', () => {
  const ddl = compileMetricViewDDL(
    { full_path: 'hr.core.employees', entity_label: 'Employees' },
    [{ id: 'm1', column_name: 'salary', measure_label: 'Total pay', aggregate: 'sum', expression: null, metric_type: 'simple' }],
    [{ column_name: 'dept', dimension_label: 'Dept' }],
  );

  it('reads the view and its source from generated DDL', () => {
    expect(metricViewLineage(ddl[0]!)).toBeNull(); // CREATE SCHEMA
    expect(metricViewLineage(ddl[1]!)).toEqual({ view: 'hr.spinor_semantic.mv_employees_total_pay', source: 'hr.core.employees' });
  });

  it('column and whole-path protections on the source become whole-path protections on the view', async () => {
    tables.ct.push({ tag_id: 'comp', table_path: 'hr.core.employees', status: 'confirmed' });
    tables.pp.push({ tag_id: 'hr-restricted', path: 'hr.core' });
    const n = await inheritProtectionsForView('org', 'hr.spinor_semantic.mv_employees_total_pay', 'hr.core.employees');
    expect(n).toBe(2);
    expect(tables.pp.filter((r) => r.path === 'hr.spinor_semantic.mv_employees_total_pay').map((r) => r.tag_id).sort()).toEqual(['comp', 'hr-restricted']);
    expect(bumpPolicyVersion).toHaveBeenCalledWith('org');
  });

  it('an unprotected source adds nothing', async () => {
    expect(await inheritProtectionsForView('org', 'a.b.v', 'a.b.t')).toBe(0);
    expect(bumpPolicyVersion).not.toHaveBeenCalled();
  });
});
