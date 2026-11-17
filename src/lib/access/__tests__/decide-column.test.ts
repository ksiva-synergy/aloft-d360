import { describe, expect, it } from 'vitest';
import {
  columnAccessMessage,
  decideColumn,
  decideColumns,
  friendlyColumnName,
  tableHasTaggedColumns,
  userTagLevel,
  type ColumnRef,
} from '../decide-column';
import type { AccessPrincipal, ColumnPolicy, TagGrantRow } from '../types';

const NOW = new Date('2026-11-07T12:00:00Z').getTime();
const PAST = new Date('2026-11-01T00:00:00Z');
const FUTURE = new Date('2026-12-01T00:00:00Z');

const TABLE = 'main.crew.contracts';

function user(userId: string): AccessPrincipal {
  return { kind: 'user', orgId: 'org', userId, departmentIds: [], clearance: 'internal' };
}

function policy(opts: {
  grants?: TagGrantRow[];
  groups?: Record<string, { groupId: string; expiresAt: Date | null }[]>;
  columnTags?: Record<string, string[]>;
} = {}): { columns: ColumnPolicy } {
  const byColumn = new Map<string, string[]>(
    Object.entries(opts.columnTags ?? { salary_amount: ['comp'], bank_iban: ['bank'], medical_note: ['comp', 'med'] }),
  );
  return {
    columns: {
      tags: new Map([
        ['comp', { id: 'comp', key: 'compensation', name: 'Compensation', requiresTwoApprovals: false }],
        ['bank', { id: 'bank', key: 'bank', name: 'Bank details', requiresTwoApprovals: false }],
        ['med', { id: 'med', key: 'medical', name: 'Medical', requiresTwoApprovals: true }],
      ]),
      columnTags: new Map([[TABLE, byColumn]]),
      tagGrants: opts.grants ?? [],
      groupsByUser: new Map(Object.entries(opts.groups ?? {})),
    },
  };
}

const payroll: TagGrantRow = { tagId: 'comp', principalType: 'group', principalId: 'payroll', level: 'full', expiresAt: null };
const managersTotals: TagGrantRow = {
  tagId: 'comp',
  principalType: 'group',
  principalId: 'managers',
  level: 'aggregate',
  expiresAt: null,
};

const ref = (column: string, use: ColumnRef['use']): ColumnRef => ({ table: TABLE, column, use });

describe('decideColumn', () => {
  it('untagged column is full for everyone', () => {
    const d = decideColumn(user('ana'), policy(), ref('rank', 'filter'), NOW);
    expect(d.access).toBe('full');
    expect(d.missingTags).toEqual([]);
  });

  it('no grant: output is masked, filter is refused, aggregate is masked', () => {
    const p = policy({ grants: [payroll] });
    expect(decideColumn(user('ana'), p, ref('salary_amount', 'output'), NOW).access).toBe('masked');
    expect(decideColumn(user('ana'), p, ref('salary_amount', 'filter'), NOW).access).toBe('refused');
    expect(decideColumn(user('ana'), p, ref('salary_amount', 'aggregate'), NOW).access).toBe('masked');
  });

  it('group member with full grant gets real values for every use', () => {
    const p = policy({ grants: [payroll], groups: { priya: [{ groupId: 'payroll', expiresAt: null }] } });
    for (const use of ['output', 'filter', 'aggregate'] as const) {
      expect(decideColumn(user('priya'), p, ref('salary_amount', use), NOW).access).toBe('full');
    }
  });

  it('direct user grant works without a group', () => {
    const p = policy({ grants: [{ ...payroll, principalType: 'user', principalId: 'ben' }] });
    expect(decideColumn(user('ben'), p, ref('salary_amount', 'filter'), NOW).access).toBe('full');
  });

  it('totals only: aggregates allowed, individual values masked, filters refused', () => {
    const p = policy({ grants: [managersTotals], groups: { mark: [{ groupId: 'managers', expiresAt: null }] } });
    expect(decideColumn(user('mark'), p, ref('salary_amount', 'aggregate'), NOW).access).toBe('aggregate');
    expect(decideColumn(user('mark'), p, ref('salary_amount', 'output'), NOW).access).toBe('masked');
    expect(decideColumn(user('mark'), p, ref('salary_amount', 'filter'), NOW).access).toBe('refused');
  });

  it('expired membership gives nothing', () => {
    const p = policy({ grants: [payroll], groups: { priya: [{ groupId: 'payroll', expiresAt: PAST }] } });
    expect(decideColumn(user('priya'), p, ref('salary_amount', 'output'), NOW).access).toBe('masked');
  });

  it('membership with a future end date still works', () => {
    const p = policy({ grants: [payroll], groups: { priya: [{ groupId: 'payroll', expiresAt: FUTURE }] } });
    expect(decideColumn(user('priya'), p, ref('salary_amount', 'output'), NOW).access).toBe('full');
  });

  it('expired grant gives nothing', () => {
    const p = policy({
      grants: [{ ...payroll, expiresAt: PAST }],
      groups: { priya: [{ groupId: 'payroll', expiresAt: null }] },
    });
    expect(decideColumn(user('priya'), p, ref('salary_amount', 'output'), NOW).access).toBe('masked');
  });

  it('a column with two tags needs a grant for both', () => {
    const p = policy({ grants: [payroll], groups: { priya: [{ groupId: 'payroll', expiresAt: null }] } });
    const d = decideColumn(user('priya'), p, ref('medical_note', 'output'), NOW);
    expect(d.access).toBe('masked');
    expect(d.missingTags.map((t) => t.name)).toEqual(['Medical']);
  });

  it('the lowest level across tags wins', () => {
    const p = policy({
      grants: [payroll, { tagId: 'med', principalType: 'user', principalId: 'priya', level: 'aggregate', expiresAt: null }],
      groups: { priya: [{ groupId: 'payroll', expiresAt: null }] },
    });
    expect(decideColumn(user('priya'), p, ref('medical_note', 'aggregate'), NOW).access).toBe('aggregate');
    expect(decideColumn(user('priya'), p, ref('medical_note', 'output'), NOW).access).toBe('masked');
  });

  it('a grant on another tag does not help', () => {
    const p = policy({ grants: [payroll], groups: { priya: [{ groupId: 'payroll', expiresAt: null }] } });
    expect(decideColumn(user('priya'), p, ref('bank_iban', 'output'), NOW).access).toBe('masked');
  });

  it('table and column names match regardless of case', () => {
    const p = policy({ grants: [payroll] });
    const d = decideColumn(user('ana'), p, { table: 'MAIN.Crew.Contracts', column: 'SALARY_AMOUNT', use: 'output' }, NOW);
    expect(d.access).toBe('masked');
  });

  it('system principals are not affected by column tags', () => {
    const sys: AccessPrincipal = { kind: 'system', orgId: 'org', systemKind: 'harvest' };
    expect(decideColumn(sys, policy(), ref('salary_amount', 'filter'), NOW).access).toBe('full');
  });

  it('no column policy loaded (migration not applied) means full', () => {
    expect(decideColumn(user('ana'), {}, ref('salary_amount', 'filter'), NOW).access).toBe('full');
  });

  it('platform admins get no automatic access (D3)', () => {
    // Principals carry no role shortcut here: an admin outside the group is treated like anyone else.
    const p = policy({ grants: [payroll] });
    expect(decideColumn(user('platform-admin'), p, ref('salary_amount', 'output'), NOW).access).toBe('masked');
  });
});

describe('decideColumns', () => {
  it('groups masked, refused and aggregate-only columns, masking each column once', () => {
    const p = policy({ grants: [payroll] });
    const plan = decideColumns(
      user('ana'),
      p,
      [ref('name', 'output'), ref('salary_amount', 'output'), ref('salary_amount', 'output'), ref('bank_iban', 'filter')],
      NOW,
    );
    expect(plan.masked.map((d) => d.column)).toEqual(['salary_amount']);
    expect(plan.refused.map((d) => d.column)).toEqual(['bank_iban']);
    expect(plan.aggregateOnly).toEqual([]);
  });
});

describe('userTagLevel', () => {
  it('picks the best level from user and group grants', () => {
    const p = policy({
      grants: [managersTotals, { ...payroll, principalType: 'user', principalId: 'mark' }],
      groups: { mark: [{ groupId: 'managers', expiresAt: null }] },
    });
    expect(userTagLevel(p.columns, 'mark', 'comp', NOW)).toBe('full');
    expect(userTagLevel(p.columns, 'nobody', 'comp', NOW)).toBe('none');
  });
});

describe('helpers', () => {
  it('friendlyColumnName', () => {
    expect(friendlyColumnName('salary_amount')).toBe('Salary amount');
    expect(friendlyColumnName('basicWage')).toBe('Basic wage');
    expect(friendlyColumnName('IBAN')).toBe('Iban');
  });

  it('tableHasTaggedColumns', () => {
    const p = policy();
    expect(tableHasTaggedColumns(p.columns, 'MAIN.CREW.CONTRACTS')).toBe(true);
    expect(tableHasTaggedColumns(p.columns, 'main.ops.voyages')).toBe(false);
    expect(tableHasTaggedColumns(undefined, TABLE)).toBe(false);
  });

  it('columnAccessMessage names the information and offers a request, never a value', () => {
    const p = policy({ grants: [payroll] });
    const masked = decideColumns(user('ana'), p, [ref('salary_amount', 'output')], NOW);
    expect(columnAccessMessage(masked)).toBe(
      "Salary amount is hidden: you don't have access to Compensation data. If you need it, request access.",
    );
    const refused = decideColumns(user('ana'), p, [ref('salary_amount', 'filter')], NOW);
    expect(columnAccessMessage(refused)).toContain("You can't filter, sort, group or join by Salary amount");
    expect(columnAccessMessage(decideColumns(user('ana'), p, [ref('rank', 'output')], NOW))).toBeNull();
  });
});
