import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessModel } from '../engine';

const C = 'cur.crew.contracts';
const comp = { id: 'comp', name: 'Compensation' };

const { state } = vi.hoisted(() => ({ state: { model: null as unknown as AccessModel } }));

vi.mock('../model-store', () => ({ getAccessModel: vi.fn(async () => ({ model: state.model, version: BigInt(1) })) }));
vi.mock('@/lib/db', () => {
  const db = {
    platformContextObject: { findMany: vi.fn(async () => [{ id: 'o1', full_path: C }]) },
    platformContextColumn: {
      findMany: vi.fn(async () => ['name', 'rank', 'fleet', 'salary_amount'].map((name, i) => ({ object_id: 'o1', name, ordinal: i }))),
    },
    accessDecisionLog: { create: vi.fn(async () => ({})) },
  };
  return { prisma: db, default: db };
});

import { applyMask, planColumnGuard } from '../column-guard';
import { stripProtectedValues } from '../describe-filter';

function model(grants: AccessModel['protectionGrants'] = []): AccessModel {
  return {
    rules: [],
    protections: new Map([[comp.id, comp]]),
    targets: [{ protectionId: 'comp', path: C, column: 'salary_amount' }],
    protectionGrants: grants,
    membersByUser: new Map([['priya', [{ groupId: 'payroll', expiresAt: null }]]]),
    bootstrapOpen: false,
  };
}
const user = (userId: string) => ({ kind: 'user' as const, orgId: 'o', userId, departmentIds: [], clearance: 'internal' as const, roles: ['member'] });
const payroll = { protectionId: 'comp', holder: { kind: 'group' as const, id: 'payroll' }, level: 'full' as const, expiresAt: null };
const totals = { protectionId: 'comp', holder: { kind: 'person' as const, id: 'mark' }, level: 'aggregate' as const, expiresAt: null };

beforeEach(() => {
  process.env.COLUMN_ACCESS_MODE = 'enforce';
  state.model = model([payroll, totals]);
});
afterEach(() => {
  delete process.env.COLUMN_ACCESS_MODE;
});

describe('planColumnGuard', () => {
  it('off by default: nothing runs', async () => {
    delete process.env.COLUMN_ACCESS_MODE;
    expect((await planColumnGuard(user('ana'), `SELECT * FROM ${C}`, [C])).applies).toBe(false);
  });

  it('tables without protected columns take the fast path', async () => {
    const p = await planColumnGuard(user('ana'), 'SELECT * FROM cur.ops.voyages', ['cur.ops.voyages']);
    expect(p).toMatchObject({ applies: false, stop: null });
  });

  it('SELECT * without access: salary masked by position, with a note and request link', async () => {
    const p = await planColumnGuard(user('ana'), `SELECT * FROM ${C} WHERE fleet = 'B'`, [C]);
    expect(p).toMatchObject({ applies: true, stop: null, maskIndexes: [{ index: 3, name: 'salary_amount' }] });
    expect(p.note).toMatchObject({ message: "Salary amount is hidden: you don't have access to Compensation data. If you need it, request access.", request: '/my-access?tag=comp' });
  });

  it('filtering on salary without access stops the query', async () => {
    const p = await planColumnGuard(user('ana'), `SELECT name FROM ${C} WHERE salary_amount > 100000`, [C]);
    expect(p.stop).toContain("You can't filter, sort, group or join by Salary amount");
  });

  it('a member of the group sees everything', async () => {
    const p = await planColumnGuard(user('priya'), `SELECT name FROM ${C} ORDER BY salary_amount`, [C]);
    expect(p).toMatchObject({ applies: true, stop: null, maskIndexes: [] });
  });

  it('totals only: aggregates run with a minimum group size; individual values masked', async () => {
    const p = await planColumnGuard(user('mark'), `SELECT rank, AVG(salary_amount) AS avg_pay FROM ${C} GROUP BY rank`, [C]);
    expect(p.stop).toBeNull();
    expect(p.statement).toContain('HAVING COUNT(*) >= 5');
    expect(p.maskIndexes).toEqual([]);
    const q = await planColumnGuard(user('mark'), `SELECT name, salary_amount FROM ${C}`, [C]);
    expect(q.maskIndexes).toEqual([{ index: 1, name: 'salary_amount' }]);
  });

  it('a query the parser cannot read is stopped when it touches protected data (fail closed)', async () => {
    const p = await planColumnGuard(user('ana'), `WITH x AS (SELECT * FROM ${C}) SELECT * FROM x`, [C]);
    expect(p).toMatchObject({ parserOk: false });
    expect(p.stop).toContain("couldn't be checked column by column");
  });

  it('records timings', async () => {
    const p = await planColumnGuard(user('ana'), `SELECT * FROM ${C}`, [C]);
    expect(p.timings.total_ms).toBeGreaterThanOrEqual(0);
    expect(Object.keys(p.timings)).toEqual(['model_ms', 'columns_ms', 'resolve_ms', 'decide_ms', 'total_ms']);
  });

  it('adversarial: expressions, aliases and CASE on salary never come back unmasked', async () => {
    for (const sql of [
      `SELECT salary_amount * 1 AS x FROM ${C}`,
      `SELECT CAST(salary_amount AS STRING) AS s FROM ${C}`,
      `SELECT c.salary_amount FROM ${C} c`,
      `SELECT concat('', salary_amount) AS y FROM ${C}`,
    ]) {
      const p = await planColumnGuard(user('ana'), sql, [C]);
      expect(p.maskIndexes.length, sql).toBe(1);
    }
    for (const sql of [
      `SELECT CASE WHEN salary_amount > 100000 THEN 'high' END AS b FROM ${C}`,
      `SELECT name FROM ${C} WHERE salary_amount BETWEEN 1 AND 2`,
      `SELECT name, RANK() OVER (ORDER BY salary_amount) r FROM ${C}`,
    ]) {
      expect((await planColumnGuard(user('ana'), sql, [C])).stop, sql).not.toBeNull();
    }
  });
});

describe('applyMask', () => {
  const result = {
    columns: ['name', 'rank', 'fleet', 'salary_amount'].map((name) => ({ name, type_name: 'STRING' })),
    rows: [{ name: 'J. Mendes', rank: 'Master', fleet: 'B', salary_amount: '185000.00' }],
    row_count: 1,
    statement_id: 's',
    truncated: false,
  };

  it('replaces protected values and attaches the note', async () => {
    const p = await planColumnGuard(user('ana'), `SELECT * FROM ${C}`, [C]);
    const out = applyMask(result, p);
    expect(out.rows[0]).toEqual({ name: 'J. Mendes', rank: 'Master', fleet: 'B', salary_amount: '•••' });
    expect(out.access_note?.masked[0]).toMatchObject({ column: `${C}.salary_amount`, protections: ['Compensation'] });
    expect(JSON.stringify(out)).not.toContain('185000');
  });

  it('when the result shape differs from the prediction it masks by name, never leaking', async () => {
    const p = await planColumnGuard(user('ana'), `SELECT * FROM ${C}`, [C]);
    const reordered = { ...result, columns: [...result.columns].reverse() };
    expect(JSON.stringify(applyMask(reordered, p))).not.toContain('185000');
  });
});

describe('describe_schema filter', () => {
  it('removes profile values of protected columns for people without access, keeps names and types', () => {
    const out = {
      full_path: C,
      columns: [
        { name: 'salary_amount', data_type: 'decimal', top_k: [{ value: 185000, count: 2 }], min: 45000, max: 210000 },
        { name: 'rank', data_type: 'string', top_k: [{ value: 'Master', count: 9 }] },
      ],
    };
    const n = stripProtectedValues(out, state.model, { userId: 'ana', roles: ['member'] });
    expect(n).toBe(3);
    expect(out.columns[0]).toEqual({ name: 'salary_amount', data_type: 'decimal', protected: 'Compensation: values hidden (no access)' });
    expect(out.columns[1]!.top_k).toBeTruthy();
    const priyaCopy = { full_path: C, columns: [{ name: 'salary_amount', min: 1 }] };
    expect(stripProtectedValues(priyaCopy, state.model, { userId: 'priya', roles: ['member'] })).toBe(0);
  });
});
