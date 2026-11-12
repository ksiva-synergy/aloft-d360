import { describe, expect, it } from 'vitest';
import { decideObject } from '@/lib/access/decide';
import { departmentNodeAccess, explainUserPath, pathTags } from '@/lib/access/explain';
import { levelAtLeast } from '@/lib/access/levels';
import type { AccessLevel, GrantRow, LabelRow, PolicySnapshot, SensitivityLabel } from '@/lib/access/types';

const policy = (grants: GrantRow[], labels: LabelRow[] = [], legacyOpen = false): PolicySnapshot => ({
  orgId: 'org',
  version: 1n,
  grants,
  labels,
  clearances: new Map(),
  membersByUser: new Map(),
  legacyOpen,
});

const g = (
  principalType: 'user' | 'department',
  principalId: string,
  path: string,
  level: AccessLevel,
  effect: 'allow' | 'deny' = 'allow',
  expiresAt: Date | null = null,
): GrantRow => ({
  principalType,
  principalId,
  path,
  pathDepth: path.split('.').length as 1 | 2 | 3,
  level,
  effect,
  expiresAt,
});

const LEVELS: AccessLevel[] = ['discover', 'query', 'export'];
const CLEARANCES: SensitivityLabel[] = ['internal', 'confidential', 'restricted'];
const PATHS = ['ops_gold', 'ops_gold.marine', 'ops_gold.marine.inspections', 'ops_gold.finance.vessel_opex', 'other.x.y'];

const SCENARIOS: Array<{ name: string; p: PolicySnapshot }> = [
  { name: 'empty, not legacy', p: policy([]) },
  { name: 'legacy open with label', p: policy([], [{ path: 'ops_gold.finance', label: 'confidential' }], true) },
  {
    name: 'marine catalog query + confidential table',
    p: policy(
      [g('department', 'marine', 'ops_gold', 'query')],
      [{ path: 'ops_gold.finance.vessel_opex', label: 'confidential' }],
    ),
  },
  {
    name: 'deny on schema under catalog grant',
    p: policy([g('department', 'marine', 'ops_gold', 'export'), g('department', 'marine', 'ops_gold.finance', 'query', 'deny')]),
  },
  {
    name: 'user direct export + dept discover + restricted catalog',
    p: policy(
      [g('user', 'u1', 'ops_gold.marine.inspections', 'export'), g('department', 'marine', 'ops_gold', 'discover')],
      [{ path: 'ops_gold', label: 'restricted' }, { path: 'ops_gold.marine', label: 'confidential' }],
    ),
  },
  {
    name: 'expired grant ignored',
    p: policy([g('department', 'marine', 'ops_gold', 'query', 'allow', new Date(Date.now() - 60_000))]),
  },
  {
    name: 'other department only',
    p: policy([g('department', 'crewing', 'ops_gold', 'query')]),
  },
  {
    name: 'member role query + admin role export on one schema',
    p: policy([g('role', 'member', 'ops_gold', 'query'), g('role', 'admin', 'ops_gold.marine', 'export')]),
  },
];

describe('explainUserPath agrees with decide()', () => {
  for (const { name, p } of SCENARIOS) {
    for (const clearance of CLEARANCES) {
      for (const path of PATHS) {
        it(`${name} · ${clearance} · ${path}`, () => {
          const user = { userId: 'u1', departmentIds: ['marine'], clearance, roles: ['member', 'readonly'] };
          const ex = explainUserPath(user, path, p);
          for (const level of LEVELS) {
            const d = decideObject(user, path, level, p);
            const allowedByExplain = ex.allowedLevel !== null && levelAtLeast(ex.allowedLevel, level);
            expect(allowedByExplain, `level ${level}`).toBe(d.decision === 'allow');
          }
          if (ex.allowedLevel === null) {
            expect(ex.reason).toBe(decideObject(user, path, 'discover', p).reason);
          }
        });
      }
    }
  }
});

describe('explainUserPath details', () => {
  it('names the grant and the label that decided the Ana / Ben / Carla case', () => {
    const p = policy(
      [g('department', 'marine', 'ops_gold', 'query')],
      [{ path: 'ops_gold.finance.vessel_opex', label: 'confidential' }],
    );
    const ana = explainUserPath({ userId: 'ana', departmentIds: ['marine'], clearance: 'internal' }, 'ops_gold.finance.vessel_opex', p);
    expect(ana.reason).toBe('needs_clearance');
    expect(ana.allow?.path).toBe('ops_gold');
    expect(ana.label).toEqual({ label: 'confidential', from: 'ops_gold.finance.vessel_opex', own: 'confidential' });

    const ben = explainUserPath({ userId: 'ben', departmentIds: ['marine'], clearance: 'confidential' }, 'ops_gold.finance.vessel_opex', p);
    expect(ben.allowedLevel).toBe('query');

    const carla = explainUserPath({ userId: 'carla', departmentIds: ['crewing'], clearance: 'confidential' }, 'ops_gold.finance.vessel_opex', p);
    expect(carla.reason).toBe('no_grant');
  });

  it('reports the deny that blocks a path', () => {
    const p = policy([g('department', 'marine', 'ops_gold', 'export'), g('department', 'marine', 'ops_gold.finance', 'query', 'deny')]);
    const ex = explainUserPath({ userId: 'u', departmentIds: ['marine'], clearance: 'internal' }, 'ops_gold.finance.t', p);
    expect(ex.reason).toBe('explicit_deny');
    expect(ex.deny?.path).toBe('ops_gold.finance');
  });
});

describe('departmentNodeAccess', () => {
  const grants = [
    g('department', 'marine', 'ops_gold', 'discover'),
    g('department', 'marine', 'ops_gold.marine', 'query'),
    g('department', 'marine', 'ops_gold.marine.inspections', 'export'),
    g('department', 'marine', 'ops_gold.finance', 'query', 'deny'),
    g('department', 'crewing', 'ops_gold', 'export'),
  ];

  it('separates direct, inherited, and inside counts', () => {
    expect(departmentNodeAccess('marine', 'ops_gold', grants)).toEqual({
      direct: 'discover',
      directDeny: false,
      inherited: null,
      inheritedFrom: null,
      blockedBy: null,
      grantsInside: 3,
    });
    expect(departmentNodeAccess('marine', 'ops_gold.marine.inspections', grants)).toMatchObject({
      direct: 'export',
      inherited: 'query',
      inheritedFrom: 'ops_gold.marine',
    });
  });

  it('reports a parent deny and ignores other departments', () => {
    expect(departmentNodeAccess('marine', 'ops_gold.finance.opex', grants)).toMatchObject({
      direct: null,
      inherited: 'discover',
      blockedBy: 'ops_gold.finance',
    });
    expect(departmentNodeAccess('crewing', 'ops_gold.marine', grants)).toMatchObject({
      inherited: 'export',
      grantsInside: 0,
    });
  });
});

describe('pathTags', () => {
  const grants = [
    g('department', 'marine', 'ops_gold', 'query'),
    g('department', 'finance', 'ops_gold.finance', 'export'),
    g('department', 'marine', 'ops_gold.finance', 'query', 'deny'),
    g('user', 'u1', 'ops_gold', 'export'),
  ];

  it('lists set-here, inherited, blocked, and inside tags', () => {
    const atCatalog = pathTags('ops_gold', grants);
    expect(atCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalId: 'marine', level: 'query', direct: true, inside: 1 }),
        expect.objectContaining({ principalId: 'finance', level: null, direct: false, inside: 1 }),
      ]),
    );
    expect(atCatalog).toHaveLength(2);

    const atTable = pathTags('ops_gold.finance.opex', grants);
    expect(atTable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalId: 'marine', deny: true, from: 'ops_gold.finance' }),
        expect.objectContaining({ principalId: 'finance', level: 'export', from: 'ops_gold.finance' }),
      ]),
    );
  });
});

describe('role grants', () => {
  it('apply to holders of the role and of higher built-in roles', async () => {
    const { effectiveDataRoles } = await import('@/lib/access/roles');
    expect(effectiveDataRoles(['member']).sort()).toEqual(['member', 'readonly']);
    expect(effectiveDataRoles(['admin']).sort()).toEqual(['admin', 'member', 'readonly']);
    expect(effectiveDataRoles(['analyst_custom'])).toEqual(['analyst_custom']);

    const p = policy([g('role', 'member', 'ops_gold.marine', 'query')]);
    const admin = { userId: 'a', departmentIds: [], clearance: 'internal' as const, roles: effectiveDataRoles(['admin']) };
    const viewer = { userId: 'v', departmentIds: [], clearance: 'internal' as const, roles: effectiveDataRoles(['readonly']) };
    expect(decideObject(admin, 'ops_gold.marine.t', 'query', p).decision).toBe('allow');
    expect(decideObject(viewer, 'ops_gold.marine.t', 'discover', p).decision).toBe('deny');
    expect(explainUserPath(admin, 'ops_gold.marine.t', p).allow?.principalType).toBe('role');
    // roles.ts imports the Prisma client; its first (cold) load can exceed the 5s default.
  }, 30_000);
});
