import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('../policy-store', () => ({ bumpPolicyVersionInTx: vi.fn(async () => {}), evictPolicySnapshot: vi.fn() }));
vi.mock('../model-store', () => ({ evictAccessModel: vi.fn() }));

import { grantApproved } from '../requests';

type Row = Record<string, unknown>;
function fakeTx(rules: Row[], grants: Row[]) {
  const match = (r: Row, w: Row) => Object.entries(w).every(([k, v]) => r[k] === v);
  return {
    rules,
    grants,
    accessRule: {
      findMany: async ({ where }: { where: Row }) => rules.filter((r) => match(r, where)),
      deleteMany: async ({ where }: { where: Row }) => {
        for (let i = rules.length - 1; i >= 0; i--) if (match(rules[i]!, where)) rules.splice(i, 1);
      },
      create: async ({ data }: { data: Row }) => rules.push(data),
    },
    accessTagGrant: {
      findUnique: async ({ where }: { where: { tag_id_principal_type_principal_id: Row } }) =>
        grants.find((g) => match(g, where.tag_id_principal_type_principal_id)) ?? null,
      upsert: async ({ where, create, update }: { where: { tag_id_principal_type_principal_id: Row }; create: Row; update: Row }) => {
        const g = grants.find((x) => match(x, where.tag_id_principal_type_principal_id));
        if (g) Object.assign(g, update);
        else grants.push(create);
      },
    },
  };
}

const pathReq = { requester_id: 'ana', target_type: 'path', tag_id: null, path: 'sales.curated' };
const tagReq = { requester_id: 'ana', target_type: 'tag', tag_id: 'comp', path: null };
const rule = (over: Row) => ({ org_id: 'org', holder_type: 'person', holder_id: 'ana', path: 'sales.curated', effect: 'use', ...over });

describe('approving a request never narrows existing access (review H5)', () => {
  it('permanent Use + export stays permanent with export after a 30-day Use approval', async () => {
    const tx = fakeTx([rule({ allow_export: true, expires_at: null })], []);
    const until = await grantApproved(tx as never, 'org', pathReq, 'use' as never, 30, 'boss', 'r1');
    expect(until).toBeNull();
    expect(tx.rules).toHaveLength(1);
    expect(tx.rules[0]).toMatchObject({ allow_export: true, expires_at: null });
  });

  it('the later end date wins', async () => {
    const far = new Date(Date.now() + 90 * 86_400_000);
    const tx = fakeTx([rule({ allow_export: false, expires_at: far })], []);
    await grantApproved(tx as never, 'org', pathReq, 'export' as never, 30, 'boss', 'r1');
    expect(tx.rules[0]).toMatchObject({ allow_export: true, expires_at: far });
  });

  it('an expired rule is not carried over', async () => {
    const tx = fakeTx([rule({ allow_export: true, expires_at: new Date(Date.now() - 1000) })], []);
    const until = await grantApproved(tx as never, 'org', pathReq, 'use' as never, 30, 'boss', 'r1');
    expect(tx.rules[0]).toMatchObject({ allow_export: false });
    expect(until).not.toBeNull();
  });

  it('Exact values is not downgraded by approving Totals only', async () => {
    const tx = fakeTx([], [{ tag_id: 'comp', principal_type: 'user', principal_id: 'ana', level: 'full', expires_at: null }]);
    await grantApproved(tx as never, 'org', tagReq, 'aggregate' as never, 30, 'boss', 'r1');
    expect(tx.grants[0]).toMatchObject({ level: 'full', expires_at: null });
  });

  it('a new grant gets what was approved', async () => {
    const tx = fakeTx([], []);
    await grantApproved(tx as never, 'org', tagReq, 'aggregate' as never, 30, 'boss', 'r1');
    expect(tx.grants[0]).toMatchObject({ level: 'aggregate' });
  });
});
