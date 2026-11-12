import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import { decideColumn } from '../decide-column';
import { effectiveDataRoles } from '../roles';
import {
  authorizeWithModel,
  canOpen,
  decideColumnUse,
  decideLevel,
  fromLegacy,
  missingPathProtections,
  tierForPath,
  type AccessModel,
  type Person,
} from '../engine';
import type {
  AccessPrincipal,
  ColumnPolicy,
  GrantRow,
  LabelRow,
  PolicySnapshot,
  SensitivityLabel,
  TagGrantRow,
} from '../types';

const NOW = new Date('2026-11-08T12:00:00Z').getTime();
const PAST = new Date('2026-11-01T00:00:00Z');
const FUTURE = new Date('2026-12-01T00:00:00Z');

/* ── Readable cases for the new model ───────────────────────────────────────── */

function model(partial: Partial<AccessModel>): AccessModel {
  return {
    rules: [],
    protections: new Map(),
    targets: [],
    protectionGrants: [],
    membersByUser: new Map(),
    bootstrapOpen: false,
    ...partial,
  };
}

const ana: Person = { userId: 'ana', roles: ['member'] };
const ro: Person = { userId: 'rita', roles: ['readonly'] };
const comp = { id: 'comp', name: 'Compensation' };
const fin = { id: 'fin', name: 'Confidential finance' };

describe('canOpen', () => {
  it('deny by default', () => {
    expect(canOpen(model({}), ana, 'main.crew.contracts', 'use', NOW)).toEqual({ ok: false, reason: 'no_access' });
  });

  it('a group rule on a catalog opens its tables; export needs Allow export', () => {
    const m = model({
      rules: [{ holder: { kind: 'group', id: 'marine' }, path: 'main', effect: 'use', allowExport: false, expiresAt: null }],
      membersByUser: new Map([['ana', [{ groupId: 'marine', expiresAt: null }]]]),
    });
    expect(canOpen(m, ana, 'main.crew.contracts', 'use', NOW).ok).toBe(true);
    expect(canOpen(m, ana, 'main.crew.contracts', 'export', NOW)).toEqual({ ok: false, reason: 'no_access' });
    expect(canOpen(m, ana, 'other.x.y', 'use', NOW).ok).toBe(false);
  });

  it('built-in groups follow the role ladder: Members covers Admins, not Read only', () => {
    const m = model({ rules: [{ holder: { kind: 'builtin', id: 'member' }, path: 'main', effect: 'use', allowExport: false, expiresAt: null }] });
    expect(canOpen(m, ana, 'main.a.b', 'use', NOW).ok).toBe(true);
    expect(canOpen(m, { userId: 'adm', roles: ['admin'] }, 'main.a.b', 'use', NOW).ok).toBe(true);
    expect(canOpen(m, ro, 'main.a.b', 'use', NOW).ok).toBe(false);
  });

  it('Everyone covers read-only people too', () => {
    const m = model({ rules: [{ holder: { kind: 'builtin', id: 'readonly' }, path: 'main', effect: 'use', allowExport: false, expiresAt: null }] });
    expect(canOpen(m, ro, 'main.a.b', 'use', NOW).ok).toBe(true);
  });

  it('a block anywhere on the path wins', () => {
    const m = model({
      rules: [
        { holder: { kind: 'builtin', id: 'readonly' }, path: 'main', effect: 'use', allowExport: true, expiresAt: null },
        { holder: { kind: 'person', id: 'ana' }, path: 'main.hr', effect: 'block', allowExport: false, expiresAt: null },
      ],
    });
    expect(canOpen(m, ana, 'main.hr.payroll', 'use', NOW)).toEqual({ ok: false, reason: 'blocked' });
    expect(canOpen(m, ana, 'main.crew.contracts', 'use', NOW).ok).toBe(true);
  });

  it('expired rules and memberships count for nothing', () => {
    const m = model({
      rules: [{ holder: { kind: 'group', id: 'marine' }, path: 'main', effect: 'use', allowExport: false, expiresAt: PAST }],
      membersByUser: new Map([['ana', [{ groupId: 'marine', expiresAt: null }]]]),
    });
    expect(canOpen(m, ana, 'main.a.b', 'use', NOW).ok).toBe(false);
    const m2 = model({
      rules: [{ holder: { kind: 'group', id: 'marine' }, path: 'main', effect: 'use', allowExport: false, expiresAt: FUTURE }],
      membersByUser: new Map([['ana', [{ groupId: 'marine', expiresAt: PAST }]]]),
    });
    expect(canOpen(m2, ana, 'main.a.b', 'use', NOW).ok).toBe(false);
  });

  it('a protected table needs the protection; the refusal names it', () => {
    const m = model({
      rules: [{ holder: { kind: 'builtin', id: 'readonly' }, path: 'main', effect: 'use', allowExport: false, expiresAt: null }],
      protections: new Map([[fin.id, fin]]),
      targets: [{ protectionId: fin.id, path: 'main.finance', column: null }],
      protectionGrants: [{ protectionId: fin.id, holder: { kind: 'person', id: 'ben' }, level: 'full', expiresAt: null }],
    });
    expect(canOpen(m, ana, 'main.finance.opex', 'use', NOW)).toEqual({ ok: false, reason: 'protected', protections: [fin] });
    expect(canOpen(m, { userId: 'ben', roles: ['member'] }, 'main.finance.opex', 'use', NOW).ok).toBe(true);
    expect(canOpen(m, ana, 'main.crew.contracts', 'use', NOW).ok).toBe(true);
  });

  it('no table access is reported before protection (no hint that protected data exists)', () => {
    const m = model({ protections: new Map([[fin.id, fin]]), targets: [{ protectionId: fin.id, path: 'main.finance', column: null }] });
    expect(canOpen(m, ana, 'main.finance.opex', 'use', NOW)).toEqual({ ok: false, reason: 'no_access' });
  });

  it('bootstrap: with no rules yet, unprotected data is open and protected data is not', () => {
    const m = model({ bootstrapOpen: true, protections: new Map([[fin.id, fin]]), targets: [{ protectionId: fin.id, path: 'main.finance', column: null }] });
    expect(canOpen(m, ana, 'main.crew.contracts', 'export', NOW)).toEqual({ ok: true, reason: 'bootstrap_open' });
    expect(canOpen(m, ana, 'main.finance.opex', 'use', NOW).ok).toBe(false);
  });
});

describe('platform admins see all data', () => {
  const admin: Person = { userId: 'u-pa', roles: ['platform_admin'] };
  const comp = { id: 't-comp', name: 'Compensation' };
  const m = model({
    rules: [{ holder: { kind: 'person', id: 'u-pa' }, path: 'hr', effect: 'block', allowExport: false, expiresAt: null }],
    protections: new Map([[comp.id, comp]]),
    targets: [
      { protectionId: comp.id, path: 'hr.pay', column: null },
      { protectionId: comp.id, path: 'fin.x.salaries', column: 'amount' },
    ],
  });

  it('opens any path for Use and export, past a Block and a whole-path protection, with no rules', () => {
    expect(canOpen(m, admin, 'hr.pay.t', 'export', NOW)).toEqual({ ok: true, reason: 'platform_admin' });
    expect(canOpen(m, admin, 'unknown.s.t', 'use', NOW).ok).toBe(true);
  });

  it('sees protected columns in full, including filters', () => {
    expect(decideColumnUse(m, admin, 'fin.x.salaries', 'amount', 'output', NOW).outcome).toBe('full');
    expect(decideColumnUse(m, admin, 'fin.x.salaries', 'amount', 'filter', NOW).outcome).toBe('full');
  });

  it('other roles are unchanged', () => {
    expect(canOpen(m, { userId: 'u-x', roles: ['admin'] }, 'unknown.s.t', 'use', NOW)).toEqual({ ok: false, reason: 'no_access' });
    expect(decideColumnUse(m, { userId: 'u-x', roles: ['admin'] }, 'fin.x.salaries', 'amount', 'output', NOW).outcome).toBe('masked');
  });
});

describe('decideColumnUse', () => {
  const m = model({
    protections: new Map([
      [comp.id, comp],
      [fin.id, fin],
    ]),
    targets: [
      { protectionId: comp.id, path: 'main.crew.contracts', column: 'salary_amount' },
      { protectionId: fin.id, path: 'main.finance', column: null },
    ],
    protectionGrants: [
      { protectionId: comp.id, holder: { kind: 'group', id: 'payroll' }, level: 'full', expiresAt: null },
      { protectionId: comp.id, holder: { kind: 'person', id: 'mark' }, level: 'aggregate', expiresAt: null },
      { protectionId: fin.id, holder: { kind: 'person', id: 'mark' }, level: 'aggregate', expiresAt: null },
    ],
    membersByUser: new Map([['priya', [{ groupId: 'payroll', expiresAt: null }]]]),
  });
  const priya: Person = { userId: 'priya', roles: ['member'] };
  const mark: Person = { userId: 'mark', roles: ['member'] };

  it('unprotected column is full', () => {
    expect(decideColumnUse(m, ana, 'main.crew.contracts', 'rank', 'filter', NOW).outcome).toBe('full');
  });

  it('without the protection: output masked, filter refused, aggregate masked', () => {
    expect(decideColumnUse(m, ana, 'main.crew.contracts', 'salary_amount', 'output', NOW)).toEqual({ outcome: 'masked', missing: [comp] });
    expect(decideColumnUse(m, ana, 'main.crew.contracts', 'salary_amount', 'filter', NOW).outcome).toBe('refused');
    expect(decideColumnUse(m, ana, 'main.crew.contracts', 'salary_amount', 'aggregate', NOW).outcome).toBe('masked');
  });

  it('group member sees everything; totals-only person gets aggregates only', () => {
    expect(decideColumnUse(m, priya, 'main.crew.contracts', 'SALARY_AMOUNT', 'filter', NOW).outcome).toBe('full');
    expect(decideColumnUse(m, mark, 'main.crew.contracts', 'salary_amount', 'aggregate', NOW).outcome).toBe('aggregate');
    expect(decideColumnUse(m, mark, 'main.crew.contracts', 'salary_amount', 'output', NOW).outcome).toBe('masked');
  });

  it('a whole-table protection at Totals only applies to every column of that table', () => {
    expect(decideColumnUse(m, mark, 'main.finance.opex', 'amount', 'aggregate', NOW).outcome).toBe('aggregate');
    expect(decideColumnUse(m, mark, 'main.finance.opex', 'vessel', 'output', NOW).outcome).toBe('masked');
  });
});

/* ── Old engine vs new engine on random rule sets (S1 exit criterion) ──────── */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PATHS = ['main', 'main.crew', 'main.crew.contracts', 'main.crew.ranks', 'main.hr', 'main.hr.payroll', 'ops', 'ops.fleet', 'ops.fleet.voyages'];
const TABLES = PATHS.filter((p) => p.split('.').length === 3);
const USERS = ['u1', 'u2', 'u3', 'u4'];
const DEPTS = ['d1', 'd2'];
const ROLES = ['readonly', 'member', 'admin'];
const COLUMNS = ['salary', 'email', 'rank'];

function randomSnapshot(r: () => number): { snapshot: PolicySnapshot; rolesByUser: Map<string, string[]> } {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const grants: GrantRow[] = [];
  const nGrants = r() < 0.15 ? 0 : 1 + Math.floor(r() * 6);
  for (let i = 0; i < nGrants; i++) {
    const kind = pick(['user', 'department', 'role'] as const);
    const path = pick(PATHS);
    grants.push({
      principalType: kind,
      principalId: kind === 'user' ? pick(USERS) : kind === 'department' ? pick(DEPTS) : pick(ROLES),
      path,
      pathDepth: path.split('.').length as 1 | 2 | 3,
      level: pick(['discover', 'query', 'export'] as const),
      effect: r() < 0.15 ? 'deny' : 'allow',
      expiresAt: r() < 0.1 ? PAST : r() < 0.1 ? FUTURE : null,
    });
  }
  const labels: LabelRow[] = [];
  for (const p of PATHS) {
    if (r() < 0.12) labels.push({ path: p, label: r() < 0.5 ? 'confidential' : 'restricted' });
  }
  const clearances = new Map<string, SensitivityLabel>();
  for (const u of USERS) {
    const x = r();
    if (x < 0.25) clearances.set(u, 'confidential');
    else if (x < 0.4) clearances.set(u, 'restricted');
  }
  const membersByUser = new Map<string, string[]>();
  for (const u of USERS) {
    const ds = DEPTS.filter(() => r() < 0.4);
    if (ds.length) membersByUser.set(u, ds);
  }
  const rolesByUser = new Map(USERS.map((u) => [u, [pick(ROLES)]]));

  const columns: ColumnPolicy = { tags: new Map(), columnTags: new Map(), tagGrants: [], groupsByUser: new Map() };
  for (const id of ['t1', 't2']) columns.tags.set(id, { id, key: id, name: id.toUpperCase(), requiresTwoApprovals: false });
  for (const t of TABLES) {
    for (const c of COLUMNS) {
      const ids = ['t1', 't2'].filter(() => r() < 0.25);
      if (!ids.length) continue;
      const byCol = columns.columnTags.get(t) ?? new Map<string, string[]>();
      byCol.set(c, ids);
      columns.columnTags.set(t, byCol);
    }
  }
  for (const id of ['t1', 't2']) {
    if (r() < 0.6) {
      const g: TagGrantRow = {
        tagId: id,
        principalType: r() < 0.5 ? 'group' : 'user',
        principalId: '',
        level: r() < 0.5 ? 'full' : 'aggregate',
        expiresAt: r() < 0.15 ? PAST : null,
      };
      g.principalId = g.principalType === 'group' ? 'g1' : pick(USERS);
      columns.tagGrants.push(g);
    }
  }
  for (const u of USERS) {
    if (r() < 0.4) columns.groupsByUser.set(u, [{ groupId: 'g1', expiresAt: r() < 0.2 ? PAST : null }]);
  }

  return {
    snapshot: {
      orgId: 'org',
      version: BigInt(1),
      grants,
      labels,
      clearances,
      membersByUser,
      legacyOpen: grants.length === 0,
      columns,
    },
    rolesByUser,
  };
}

const OLD_TO_NEW: Record<string, string> = {
  explicit_deny: 'blocked',
  no_grant: 'no_access',
  needs_clearance: 'protected',
};

describe('new engine agrees with the old one on today\'s rules', { timeout: 60_000 }, () => {
  it('table decisions (query → use, export → export) on 3000 random rule sets', () => {
    const r = rng(42);
    let compared = 0;
    const seen = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const { snapshot, rolesByUser } = randomSnapshot(r);
      const m = fromLegacy(snapshot);
      for (const userId of USERS) {
        const roles = rolesByUser.get(userId)!;
        const principal: AccessPrincipal = {
          kind: 'user',
          orgId: 'org',
          userId,
          departmentIds: snapshot.membersByUser.get(userId) ?? [],
          clearance: snapshot.clearances.get(userId) ?? 'internal',
          roles: effectiveDataRoles(roles),
        };
        for (const path of PATHS) {
          for (const [oldLevel, need] of [
            ['query', 'use'],
            ['export', 'export'],
          ] as const) {
            const before = decide(principal, path, oldLevel, snapshot);
            const after = canOpen(m, { userId, roles }, path, need, Date.now());
            const ctx = { i, userId, path, oldLevel, before, after };
            expect(after.ok, JSON.stringify(ctx)).toBe(before.allowed);
            if (!before.allowed && !after.ok) expect(after.reason, JSON.stringify(ctx)).toBe(OLD_TO_NEW[before.reason]);
            const key = after.ok ? `allow:${after.reason ?? 'rule'}` : after.reason;
            seen.set(key, (seen.get(key) ?? 0) + 1);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(200_000);
    // Every kind of outcome was exercised, not just trivial allows or denies.
    for (const k of ['allow:rule', 'allow:bootstrap_open', 'blocked', 'no_access', 'protected']) {
      expect(seen.get(k) ?? 0, `${k} ${JSON.stringify([...seen])}`).toBeGreaterThan(1000);
    }
  });

  it('column decisions on 3000 random rule sets', () => {
    const r = rng(7);
    const seen = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const { snapshot, rolesByUser } = randomSnapshot(r);
      const m = fromLegacy(snapshot);
      for (const userId of USERS) {
        const roles = rolesByUser.get(userId)!;
        const principal: AccessPrincipal = { kind: 'user', orgId: 'org', userId, departmentIds: [], clearance: 'internal', roles };
        for (const table of TABLES) {
          // Columns are only decided after the table opens; labels never affect columns of an open table.
          if (!canOpen(m, { userId, roles }, table, 'use', Date.now()).ok) continue;
          for (const column of COLUMNS) {
            for (const use of ['output', 'filter', 'aggregate'] as const) {
              const before = decideColumn(principal, snapshot, { table, column, use }, Date.now()).access;
              const after = decideColumnUse(m, { userId, roles }, table, column, use, Date.now()).outcome;
              expect(after, JSON.stringify({ i, userId, table, column, use })).toBe(before);
              seen.set(after, (seen.get(after) ?? 0) + 1);
            }
          }
        }
      }
    }
    for (const k of ['full', 'aggregate', 'masked', 'refused']) {
      expect(seen.get(k) ?? 0, `${k} ${JSON.stringify([...seen])}`).toBeGreaterThan(500);
    }
  });

  it('known, intended difference: Discover is gone (names are visible to everyone)', () => {
    const snapshot: PolicySnapshot = {
      orgId: 'org',
      version: BigInt(1),
      grants: [{ principalType: 'user', principalId: 'u1', path: 'main', pathDepth: 1, level: 'discover', effect: 'allow', expiresAt: null }],
      labels: [],
      clearances: new Map(),
      membersByUser: new Map(),
      legacyOpen: false,
    };
    expect(fromLegacy(snapshot).rules).toEqual([]);
  });
});

describe('request-time adapter', () => {
  const restricted = { id: 'r', name: 'Restricted', key: 'restricted' };
  const m = model({
    rules: [{ holder: { kind: 'builtin', id: 'member' }, path: 'main', effect: 'use', allowExport: false, expiresAt: null }],
    protections: new Map([[restricted.id, restricted]]),
    targets: [{ protectionId: 'r', path: 'main.hr', column: null }],
    protectionGrants: [{ protectionId: 'r', holder: { kind: 'person', id: 'ben' }, level: 'full', expiresAt: null }],
  });
  const user = (userId: string): AccessPrincipal => ({ kind: 'user', orgId: 'o', userId, departmentIds: [], clearance: 'internal', roles: ['member'] });

  it('discover is always allowed (names visible to everyone)', () => {
    expect(decideLevel(m, user('ana'), 'other.x.y', 'discover').allowed).toBe(true);
    expect(decideLevel(m, user('ana'), 'main.hr.payroll', 'discover').allowed).toBe(true);
  });

  it('maps reasons to the existing deny reasons', () => {
    expect(decideLevel(m, user('ana'), 'other.x.y', 'query')).toEqual({ allowed: false, reason: 'no_grant' });
    expect(decideLevel(m, user('ana'), 'main.hr.payroll', 'query')).toEqual({ allowed: false, reason: 'needs_clearance' });
    expect(decideLevel(m, user('ana'), 'main.crew.x', 'export')).toEqual({ allowed: false, reason: 'no_grant' });
  });

  it('the tier comes from Confidential / Restricted protections', () => {
    expect(tierForPath(m, 'main.hr.payroll')).toBe('restricted');
    expect(tierForPath(m, 'main.crew.x')).toBe('internal');
    const r = authorizeWithModel(m, user('ben'), ['main.hr.payroll', 'MAIN.crew.x'], 'query');
    expect(r).toMatchObject({ ok: true, tier: 'restricted' });
  });

  it('a refused query names its paths and the missing protection', () => {
    const r = authorizeWithModel(m, user('ana'), ['main.crew.x', 'main.hr.payroll'], 'query');
    expect(r).toMatchObject({ ok: false, reason: 'needs_clearance', failedPath: 'main.hr.payroll', visiblePaths: ['main.crew.x', 'main.hr.payroll'] });
    expect(missingPathProtections(m, user('ana'), 'main.hr.payroll')).toEqual(['Restricted']);
  });

  it('system principals are not governed by the model', () => {
    expect(decideLevel(m, { kind: 'system', orgId: 'o', systemKind: 'harvest' }, 'main.hr.payroll', 'query').allowed).toBe(true);
  });
});
