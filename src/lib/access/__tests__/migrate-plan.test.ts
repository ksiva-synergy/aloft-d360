import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import { decideColumn } from '../decide-column';
import { effectiveDataRoles } from '../roles';
import { canOpen, decideColumnUse } from '../engine';
import { buildAccessModel, type AccessModelRows } from '../model-store';
import { copyWouldOpenData, planCopy, rowsAfterCopy, type CurrentRows } from '../migrate-plan';
import type { AccessPrincipal, ColumnPolicy, PolicySnapshot, SensitivityLabel } from '../types';

const PAST = new Date('2020-01-01T00:00:00Z');
const FUTURE = new Date('2099-01-01T00:00:00Z');
const PATHS = ['main', 'main.crew', 'main.crew.contracts', 'main.crew.ranks', 'main.hr', 'main.hr.payroll', 'ops', 'ops.fleet', 'ops.fleet.voyages'];
const TABLES = PATHS.filter((p) => p.split('.').length === 3);
const USERS = ['u1', 'u2', 'u3', 'u4'];
const DEPTS = ['d1', 'd2'];
const ROLES = ['readonly', 'member', 'admin'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Random current rows, plus the column-protection rows that already live in the new tables. */
function randomWorld(r: () => number) {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const cur: CurrentRows = {
    departments: DEPTS.map((id) => ({ id, key: id, name: id.toUpperCase(), archived_at: null })),
    departmentMembers: [],
    grants: [],
    labels: [],
    clearances: [],
  };
  for (const u of USERS) for (const d of DEPTS) if (r() < 0.4) cur.departmentMembers.push({ department_id: d, user_id: u });
  const n = r() < 0.1 ? 0 : 1 + Math.floor(r() * 6);
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const t = pick(['user', 'department', 'role'] as const);
    const path = pick(PATHS);
    const id = t === 'user' ? pick(USERS) : t === 'department' ? pick(DEPTS) : pick(ROLES);
    const effect = r() < 0.15 ? 'deny' : 'allow';
    const k = `${t}|${id}|${path}|${effect}`;
    if (seen.has(k)) continue; // matches the unique index on access_grants
    seen.add(k);
    cur.grants.push({
      id: `g${i}`,
      principal_type: t,
      principal_id: id,
      path,
      path_depth: path.split('.').length,
      level: pick(['discover', 'query', 'export']),
      effect,
      expires_at: r() < 0.1 ? PAST : r() < 0.1 ? FUTURE : null,
    });
  }
  PATHS.forEach((p, i) => {
    if (r() < 0.12) cur.labels.push({ id: `l${i}`, path: p, path_depth: p.split('.').length, label: r() < 0.5 ? 'confidential' : 'restricted' });
  });
  for (const u of USERS) {
    const x = r();
    if (x < 0.25) cur.clearances.push({ user_id: u, level: 'confidential', expires_at: null });
    else if (x < 0.4) cur.clearances.push({ user_id: u, level: 'restricted', expires_at: null });
  }

  // Column protections already in the new tables (unchanged by the copy).
  const existing: AccessModelRows = {
    rules: [],
    tags: [
      { id: 't1', name: 'T1', archived_at: null },
      { id: 't2', name: 'T2', archived_at: null },
    ],
    pathProtections: [],
    columnTags: [],
    tagGrants: [],
    groups: [{ id: 'g1', archived_at: null }],
    members: [],
  };
  for (const t of TABLES) for (const c of ['salary', 'email']) for (const tag of ['t1', 't2']) if (r() < 0.2) existing.columnTags.push({ tag_id: tag, table_path: t, column_name: c, status: 'confirmed' });
  for (const tag of ['t1', 't2']) {
    if (r() < 0.6) {
      const group = r() < 0.5;
      existing.tagGrants.push({ tag_id: tag, principal_type: group ? 'group' : 'user', principal_id: group ? 'g1' : pick(USERS), level: r() < 0.5 ? 'full' : 'aggregate', expires_at: null });
    }
  }
  for (const u of USERS) if (r() < 0.4) existing.members.push({ group_id: 'g1', user_id: u, expires_at: null });
  const rolesByUser = new Map(USERS.map((u) => [u, [pick(ROLES)]]));
  return { cur, existing, rolesByUser };
}

/** Today's snapshot from the same rows, the way policy-store loads it. */
function oldSnapshot(cur: CurrentRows, existing: AccessModelRows): PolicySnapshot {
  const membersByUser = new Map<string, string[]>();
  for (const m of cur.departmentMembers) membersByUser.set(m.user_id, [...(membersByUser.get(m.user_id) ?? []), m.department_id]);
  const clearances = new Map<string, SensitivityLabel>();
  for (const c of cur.clearances) clearances.set(c.user_id, c.level as SensitivityLabel);
  const columns: ColumnPolicy = { tags: new Map(), columnTags: new Map(), tagGrants: [], groupsByUser: new Map() };
  for (const t of existing.tags) columns.tags.set(t.id, { id: t.id, key: t.id, name: t.name, requiresTwoApprovals: false });
  for (const c of existing.columnTags) {
    const byCol = columns.columnTags.get(c.table_path) ?? new Map<string, string[]>();
    byCol.set(c.column_name, [...(byCol.get(c.column_name) ?? []), c.tag_id]);
    columns.columnTags.set(c.table_path, byCol);
  }
  for (const g of existing.tagGrants) {
    columns.tagGrants.push({ tagId: g.tag_id, principalType: g.principal_type as 'group' | 'user', principalId: g.principal_id, level: g.level as 'full' | 'aggregate', expiresAt: g.expires_at });
  }
  for (const m of existing.members) columns.groupsByUser.set(m.user_id, [...(columns.groupsByUser.get(m.user_id) ?? []), { groupId: m.group_id, expiresAt: m.expires_at }]);
  return {
    orgId: 'org',
    version: BigInt(1),
    grants: cur.grants.map((g) => ({
      principalType: g.principal_type as 'user' | 'department' | 'role',
      principalId: g.principal_id,
      path: g.path,
      pathDepth: g.path_depth as 1 | 2 | 3,
      level: g.level as 'discover' | 'query' | 'export',
      effect: g.effect as 'allow' | 'deny',
      expiresAt: g.expires_at,
    })),
    labels: cur.labels.map((l) => ({ path: l.path, pathDepth: l.path_depth as 1 | 2 | 3, label: l.label as 'confidential' | 'restricted' })),
    clearances,
    membersByUser,
    legacyOpen: cur.grants.length === 0,
    columns,
  };
}

describe('copy plan → new tables → loader → engine gives everyone today\'s access', { timeout: 60_000 }, () => {
  it('2000 random worlds, every person, path, level and protected column', () => {
    const r = rng(2026);
    let compared = 0;
    let skippedOpenData = 0;
    for (let i = 0; i < 2000; i++) {
      const { cur, existing, rolesByUser } = randomWorld(r);
      const plan = planCopy(cur);
      if (copyWouldOpenData(cur, plan)) {
        skippedOpenData++; // the script refuses this case
        continue;
      }
      const model = buildAccessModel(rowsAfterCopy(plan, existing));
      const snapshot = oldSnapshot(cur, existing);
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
        const person = { userId, roles };
        for (const path of PATHS) {
          for (const [lvl, need] of [
            ['query', 'use'],
            ['export', 'export'],
          ] as const) {
            const before = decide(principal, path, lvl, snapshot).allowed;
            const after = canOpen(model, person, path, need).ok;
            expect(after, JSON.stringify({ i, userId, path, lvl })).toBe(before);
            compared++;
          }
        }
        for (const table of TABLES) {
          if (!canOpen(model, person, table, 'use').ok) continue;
          for (const column of ['salary', 'email', 'rank']) {
            for (const use of ['output', 'filter', 'aggregate'] as const) {
              const before = decideColumn(principal, snapshot, { table, column, use }).access;
              const after = decideColumnUse(model, person, table, column, use).outcome;
              expect(after, JSON.stringify({ i, userId, table, column, use })).toBe(before);
              compared++;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100_000);
    expect(skippedOpenData).toBeLessThan(200);
  });

  it('maps each kind of row as documented', () => {
    const plan = planCopy({
      departments: [{ id: 'd1', key: 'marine', name: 'Marine', archived_at: null }],
      departmentMembers: [{ department_id: 'd1', user_id: 'ana' }],
      grants: [
        { id: 'a', principal_type: 'department', principal_id: 'd1', path: 'Main', path_depth: 1, level: 'query', effect: 'allow', expires_at: null },
        { id: 'b', principal_type: 'role', principal_id: 'member', path: 'ops', path_depth: 1, level: 'export', effect: 'allow', expires_at: null },
        { id: 'c', principal_type: 'user', principal_id: 'ana', path: 'main.hr', path_depth: 2, level: 'query', effect: 'deny', expires_at: null },
        { id: 'd', principal_type: 'user', principal_id: 'ben', path: 'main', path_depth: 1, level: 'discover', effect: 'allow', expires_at: null },
      ],
      labels: [{ id: 'l1', path: 'system', path_depth: 1, label: 'restricted' }],
      clearances: [{ user_id: 'ben', level: 'restricted', expires_at: null }],
    });
    expect(plan.groups).toEqual([{ id: 'dept:d1', departmentId: 'd1', key: 'marine', name: 'Marine', archived_at: null }]);
    expect(plan.members).toEqual([{ group_id: 'dept:d1', user_id: 'ana' }]);
    expect(plan.rules.map((r) => [r.grantId, r.holder_type, r.holder_id, r.path, r.effect, r.allow_export])).toEqual([
      ['a', 'group', 'dept:d1', 'main', 'use', false],
      ['b', 'builtin', 'member', 'ops', 'use', true],
      ['c', 'person', 'ana', 'main.hr', 'block', false],
    ]);
    expect(plan.droppedDiscoverGrantIds).toEqual(['d']);
    expect(plan.pathProtections).toEqual([{ tag_id: 'label:restricted', path: 'system', path_depth: 1, labelId: 'l1' }]);
    expect(plan.tagGrants.map((g) => g.tag_id)).toEqual(['label:restricted', 'label:confidential']);
    expect(plan.tags.map((t) => t.name).sort()).toEqual(['Confidential', 'Restricted']);
  });

  it('refuses a copy that would open data (only Discover grants)', () => {
    const cur: CurrentRows = {
      departments: [],
      departmentMembers: [],
      grants: [{ id: 'd', principal_type: 'user', principal_id: 'ben', path: 'main', path_depth: 1, level: 'discover', effect: 'allow', expires_at: null }],
      labels: [],
      clearances: [],
    };
    expect(copyWouldOpenData(cur, planCopy(cur))).toBe(true);
  });
});
