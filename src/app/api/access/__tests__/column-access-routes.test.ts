/**
 * Column access admin APIs (epic E8): tags, column tags, groups, owners, members, tag grants.
 *
 * Edges are mocked (auth, Prisma, audit, org id). The real section rules decide View / Manage, and
 * the real route code applies the platform-admin, owner and no-self rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const { db, state, writeAudit } = vi.hoisted(() => {
  const state = {
    caller: { userId: 'u-pa', role: 'platform_admin', permissions: new Set<string>() },
  };
  const tables: Record<string, Row[]> = {};
  let seq = 0;

  function matches(row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
        const cond = v as Row;
        if ('in' in cond) return (cond.in as unknown[]).includes(row[k]);
        if ('not' in cond) return row[k] !== cond.not;
        // compound unique key: { a_b: { a, b } }
        return matches(row, cond);
      }
      return row[k] === v;
    });
  }

  function model(name: string, defaults: () => Row = () => ({})) {
    tables[name] = [];
    const rows = () => tables[name]!;
    return {
      findMany: vi.fn(async (args?: { where?: Row }) => rows().filter((r) => matches(r, args?.where))),
      findFirst: vi.fn(async (args?: { where?: Row }) => rows().find((r) => matches(r, args?.where)) ?? null),
      findUnique: vi.fn(async (args: { where: Row }) => rows().find((r) => matches(r, args.where)) ?? null),
      count: vi.fn(async (args?: { where?: Row }) => rows().filter((r) => matches(r, args?.where)).length),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `${name}-${++seq}`, ...defaults(), ...data };
        rows().push(row);
        return row;
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        for (const d of data) rows().push({ ...defaults(), ...d });
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = rows().find((r) => matches(r, where));
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const row = rows().find((r) => matches(r, where));
        if (row) {
          Object.assign(row, update);
          return row;
        }
        const created = { id: `${name}-${++seq}`, ...defaults(), ...create };
        rows().push(created);
        return created;
      }),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const i = rows().findIndex((r) => matches(r, where));
        const [row] = rows().splice(i, 1);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = rows().length;
        tables[name] = rows().filter((r) => !matches(r, where));
        return { count: before - tables[name]!.length };
      }),
      groupBy: vi.fn(async () => []),
    };
  }

  const stamps = () => ({ created_at: new Date(), updated_at: new Date(), archived_at: null });
  const db: Record<string, unknown> = {
    tables,
    accessTag: model('accessTag', () => ({ ...stamps(), description: null, requires_two_approvals: false, max_duration_days: null })),
    accessColumnTag: model('accessColumnTag', () => ({ updated_at: new Date(), reason: null, set_by: null })),
    accessTagGrant: model('accessTagGrant', () => ({ created_at: new Date(), expires_at: null, reason: null, created_by: null })),
    accessGroup: model('accessGroup', () => ({ ...stamps(), description: null })),
    accessGroupOwner: model('accessGroupOwner', () => ({ added_at: new Date() })),
    accessGroupMember: model('accessGroupMember', () => ({ added_at: new Date(), expires_at: null })),
    accessPolicyVersion: model('accessPolicyVersion'),
    platformContextObject: model('platformContextObject'),
    accessRule: model('accessRule', () => ({ created_at: new Date(), expires_at: null, allow_export: false })),
    accessPathProtection: model('accessPathProtection', () => ({ created_at: new Date() })),
    accessDataDepartment: model('accessDataDepartment'),
    accessDepartmentPath: model('accessDepartmentPath'),
    accessDepartmentGroup: model('accessDepartmentGroup'),
    role: model('role'),
    platformContextColumn: model('platformContextColumn'),
    user: model('user'),
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db, state, writeAudit: vi.fn(async () => {}) };
});

vi.mock('@/lib/db', () => ({ prisma: db, default: db }));
vi.mock('@/lib/audit', () => ({ writeAudit }));
vi.mock('@/lib/databricks/connections', () => ({ getOrgId: vi.fn(async () => 'org') }));
vi.mock('@/middleware/auth', () => ({
  resolveAuth: vi.fn(async () => state.caller),
  authenticateSession: vi.fn(async () => state.caller),
}));
vi.mock('@/lib/access/semantic-search', () => ({
  searchColumnsByMeaning: vi.fn(async () => []),
  searchTablesByMeaning: vi.fn(async () => []),
  RELATIVE_CUTOFF: 0.75,
}));
vi.mock('@/lib/access/column-search-rerank', () => ({
  rerankColumnSearchHits: vi.fn(async (_q: string, hits: unknown[]) => hits),
}));

import * as tagsRoute from '../tags/route';
import * as tagRoute from '../tags/[id]/route';
import * as columnTagsRoute from '../column-tags/route';
import * as groupsRoute from '../groups/route';
import * as ownersRoute from '../groups/[id]/owners/route';
import * as membersRoute from '../groups/[id]/members/route';
import * as grantsRoute from '../tag-grants/route';
import * as searchRoute from '../column-search/route';
import * as rulesRoute from '../rules/route';
import * as pathProtectionsRoute from '../path-protections/route';

const tables = (db as { tables: Record<string, Row[]> }).tables;

const PLATFORM_ADMIN = { userId: 'u-pa', role: 'platform_admin', permissions: new Set<string>() };
/** Manage on Data access through a bundle, but not a platform admin. */
const MANAGER = { userId: 'u-mgr', role: 'admin', permissions: new Set(['section:govern.data-access:manage']) };
/** Admins have View on Data access by default. */
const VIEWER = { userId: 'u-view', role: 'admin', permissions: new Set<string>() };
const OWNER = { userId: 'u-owner', role: 'member', permissions: new Set<string>() };
const MEMBER = { userId: 'u-ana', role: 'member', permissions: new Set<string>() };

function as(caller: typeof PLATFORM_ADMIN) {
  state.caller = caller;
}

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const REASON = 'Payroll data is need-to-know';

async function json(res: Response) {
  return res.status === 204 ? null : res.json();
}

beforeEach(() => {
  for (const k of Object.keys(tables)) tables[k] = [];
  for (const id of ['u-pa', 'u-mgr', 'u-view', 'u-owner', 'u-ana', 'u-priya']) {
    tables.user!.push({ id, email: `${id}@example.com`, name: id });
  }
  writeAudit.mockClear();
  as(PLATFORM_ADMIN);
});

async function makeTag(): Promise<string> {
  as(PLATFORM_ADMIN);
  const res = await tagsRoute.POST(req('POST', '/api/access/tags', { key: 'compensation', name: 'Compensation', reason: REASON }), {} as never);
  return (await json(res)).tag.id;
}

async function makeGroup(ownerIds = ['u-owner']): Promise<string> {
  as(PLATFORM_ADMIN);
  const res = await groupsRoute.POST(
    req('POST', '/api/access/groups', { key: 'payroll', name: 'Payroll team', ownerIds, reason: REASON }),
    {} as never,
  );
  return (await json(res)).group.id;
}

describe('tags', () => {
  it('View cannot create a tag', async () => {
    as(VIEWER);
    const res = await tagsRoute.POST(req('POST', '/api/access/tags', { key: 'compensation', name: 'Compensation', reason: REASON }), {} as never);
    expect(res.status).toBe(403);
  });

  it('a reason is optional when creating a tag', async () => {
    const res = await tagsRoute.POST(req('POST', '/api/access/tags', { key: 'compensation', name: 'Compensation' }), {} as never);
    expect(res.status).toBe(201);
  });

  it('Manage creates a tag and the audit log records the reason', async () => {
    as(MANAGER);
    const res = await tagsRoute.POST(req('POST', '/api/access/tags', { key: 'Compensation', name: 'Compensation', reason: REASON }), {} as never);
    expect(res.status).toBe(201);
    expect((await json(res)).tag.key).toBe('compensation');
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'access.tag.created', metadata: { reason: REASON } }));
  });

  it('duplicate key is refused', async () => {
    await makeTag();
    const res = await tagsRoute.POST(req('POST', '/api/access/tags', { key: 'compensation', name: 'Again', reason: REASON }), {} as never);
    expect(res.status).toBe(409);
  });

  it('only a platform admin archives a tag', async () => {
    const id = await makeTag();
    as(MANAGER);
    expect((await tagRoute.DELETE(req('DELETE', `/api/access/tags/${id}`, { reason: REASON }), params(id))).status).toBe(403);
    as(PLATFORM_ADMIN);
    expect((await tagRoute.DELETE(req('DELETE', `/api/access/tags/${id}`, { reason: REASON }), params(id))).status).toBe(204);
  });

  it('only a platform admin turns off two approvals', async () => {
    const id = await makeTag();
    await tagRoute.PATCH(req('PATCH', `/api/access/tags/${id}`, { requiresTwoApprovals: true, reason: REASON }), params(id));
    as(MANAGER);
    const res = await tagRoute.PATCH(req('PATCH', `/api/access/tags/${id}`, { requiresTwoApprovals: false, reason: REASON }), params(id));
    expect(res.status).toBe(403);
  });
});

describe('column tags', () => {
  it('Manage tags columns; names are normalised and duplicates collapse', async () => {
    const tagId = await makeTag();
    as(MANAGER);
    const res = await columnTagsRoute.POST(
      req('POST', '/api/access/column-tags', {
        tablePath: 'Main.Crew.Contracts',
        columns: ['SALARY_AMOUNT', 'salary_amount', 'basic_wage'],
        tagId,
        reason: REASON,
      }),
      {} as never,
    );
    expect(res.status).toBe(201);
    expect(tables.accessColumnTag!.map((r) => `${r.table_path}.${r.column_name}`)).toEqual([
      'main.crew.contracts.salary_amount',
      'main.crew.contracts.basic_wage',
    ]);
  });

  it('a table path must have three parts', async () => {
    const tagId = await makeTag();
    const res = await columnTagsRoute.POST(
      req('POST', '/api/access/column-tags', { tablePath: 'main.crew', columns: ['x'], tagId, reason: REASON }),
      {} as never,
    );
    expect(res.status).toBe(400);
  });

  it('only a platform admin removes a tag from a column', async () => {
    const tagId = await makeTag();
    await columnTagsRoute.POST(
      req('POST', '/api/access/column-tags', { tablePath: 'main.crew.contracts', columns: ['salary_amount'], tagId, reason: REASON }),
      {} as never,
    );
    const body = { tablePath: 'main.crew.contracts', column: 'salary_amount', tagId, reason: REASON };
    as(MANAGER);
    expect((await columnTagsRoute.DELETE(req('DELETE', '/api/access/column-tags', body), {} as never)).status).toBe(403);
    as(PLATFORM_ADMIN);
    expect((await columnTagsRoute.DELETE(req('DELETE', '/api/access/column-tags', body), {} as never)).status).toBe(204);
    expect(tables.accessColumnTag).toEqual([]);
  });
});

describe('groups and owners', () => {
  it('a group needs at least one owner', async () => {
    const res = await groupsRoute.POST(
      req('POST', '/api/access/groups', { key: 'payroll', name: 'Payroll team', ownerIds: [], reason: REASON }),
      {} as never,
    );
    expect(res.status).toBe(400);
  });

  it('one owner is enough', async () => {
    const id = await makeGroup(['u-owner']);
    expect(tables.accessGroupOwner!.filter((o) => o.group_id === id)).toHaveLength(1);
  });

  it('the last owner cannot be removed', async () => {
    const id = await makeGroup(['u-owner']);
    const res = await ownersRoute.DELETE(req('DELETE', `/api/access/groups/${id}/owners`, { userId: 'u-owner', reason: REASON }), params(id));
    expect(res.status).toBe(409);
  });

  it('only a platform admin changes owners', async () => {
    const id = await makeGroup();
    as(MANAGER);
    const res = await ownersRoute.POST(req('POST', `/api/access/groups/${id}/owners`, { userId: 'u-priya', reason: REASON }), params(id));
    expect(res.status).toBe(403);
  });
});

describe('members', () => {
  it('the group owner adds a member with an end date', async () => {
    const id = await makeGroup();
    as(OWNER);
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await membersRoute.POST(
      req('POST', `/api/access/groups/${id}/members`, { userId: 'u-ana', expiresAt, reason: REASON }),
      params(id),
    );
    expect(res.status).toBe(201);
    expect(tables.accessGroupMember![0]).toMatchObject({ user_id: 'u-ana', granted_by: 'u-owner' });
  });

  it('Manage on Data access alone cannot add members, but can remove them', async () => {
    const id = await makeGroup();
    as(OWNER);
    await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-ana', reason: REASON }), params(id));
    as(MANAGER);
    expect(
      (await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-priya', reason: REASON }), params(id))).status,
    ).toBe(403);
    expect(
      (await membersRoute.DELETE(req('DELETE', `/api/access/groups/${id}/members`, { userId: 'u-ana', reason: REASON }), params(id))).status,
    ).toBe(204);
  });

  it('a non-owner member cannot add anyone', async () => {
    const id = await makeGroup();
    as(MEMBER);
    const res = await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-priya', reason: REASON }), params(id));
    expect(res.status).toBe(403);
  });

  it('nobody adds themselves, including the owner and platform admins', async () => {
    const id = await makeGroup();
    as(OWNER);
    expect(
      (await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-owner', reason: REASON }), params(id))).status,
    ).toBe(403);
    as(PLATFORM_ADMIN);
    expect(
      (await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-pa', reason: REASON }), params(id))).status,
    ).toBe(403);
  });

  describe('a group that holds a protection (review C4)', () => {
    async function protectedGroup(): Promise<string> {
      const tagId = await makeTag();
      const groupId = await makeGroup();
      as(PLATFORM_ADMIN);
      await grantsRoute.POST(
        req('POST', '/api/access/tag-grants', { tagId, principalType: 'group', principalId: groupId, level: 'full', reason: REASON }),
        {} as never,
      );
      return groupId;
    }
    const in30 = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

    it('the owner adds a member with an end date, and it is audited as a protection grant', async () => {
      const id = await protectedGroup();
      as(OWNER);
      const res = await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-ana', expiresAt: in30(), reason: REASON }), params(id));
      expect(res.status).toBe(201);
      expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'access.protection.granted_via_group', actorId: 'u-owner' }));
    });

    it('an end date is required, for owners and platform admins', async () => {
      const id = await protectedGroup();
      as(OWNER);
      const res = await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-ana', reason: REASON }), params(id));
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/Compensation · Exact values/);
      as(PLATFORM_ADMIN);
      expect((await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-ana', reason: REASON }), params(id))).status).toBe(400);
    });

    it('an end date more than a year away is refused', async () => {
      const id = await protectedGroup();
      const far = new Date(Date.now() + 400 * 86_400_000).toISOString();
      const res = await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-ana', expiresAt: far, reason: REASON }), params(id));
      expect(res.status).toBe(400);
    });

    it('a platform admin with an end date succeeds and the protection grant is audited', async () => {
      const id = await protectedGroup();
      const res = await membersRoute.POST(req('POST', `/api/access/groups/${id}/members`, { userId: 'u-ana', expiresAt: in30(), reason: REASON }), params(id));
      expect(res.status).toBe(201);
      expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'access.protection.granted_via_group' }));
    });
  });

  it('an end date in the past is refused', async () => {
    const id = await makeGroup();
    as(OWNER);
    const res = await membersRoute.POST(
      req('POST', `/api/access/groups/${id}/members`, { userId: 'u-ana', expiresAt: '2020-01-01T00:00:00Z', reason: REASON }),
      params(id),
    );
    expect(res.status).toBe(400);
  });
});

describe('tag grants', () => {
  it('only a platform admin grants a tag', async () => {
    const tagId = await makeTag();
    const groupId = await makeGroup();
    const body = { tagId, principalType: 'group', principalId: groupId, level: 'full', reason: REASON };
    as(MANAGER);
    expect((await grantsRoute.POST(req('POST', '/api/access/tag-grants', body), {} as never)).status).toBe(403);
    as(PLATFORM_ADMIN);
    const res = await grantsRoute.POST(req('POST', '/api/access/tag-grants', body), {} as never);
    expect(res.status).toBe(201);
    expect((await json(res)).grant).toMatchObject({ tagId, principalType: 'group', principalId: groupId, level: 'full' });
  });

  it('opening protected data still needs a reason', async () => {
    const tagId = await makeTag();
    const groupId = await makeGroup();
    as(PLATFORM_ADMIN);
    const noReason = { tagId, principalType: 'group', principalId: groupId, level: 'full' };
    expect((await grantsRoute.POST(req('POST', '/api/access/tag-grants', noReason), {} as never)).status).toBe(400);
  });

  it('nobody grants a tag to themselves', async () => {
    const tagId = await makeTag();
    const res = await grantsRoute.POST(
      req('POST', '/api/access/tag-grants', { tagId, principalType: 'user', principalId: 'u-pa', level: 'full', reason: REASON }),
      {} as never,
    );
    expect(res.status).toBe(403);
  });

  it('the group must exist', async () => {
    const tagId = await makeTag();
    const res = await grantsRoute.POST(
      req('POST', '/api/access/tag-grants', { tagId, principalType: 'group', principalId: 'nope', level: 'full', reason: REASON }),
      {} as never,
    );
    expect(res.status).toBe(404);
  });

  it('Manage removes a grant (narrowing)', async () => {
    const tagId = await makeTag();
    const groupId = await makeGroup();
    const created = await grantsRoute.POST(
      req('POST', '/api/access/tag-grants', { tagId, principalType: 'group', principalId: groupId, level: 'aggregate', reason: REASON }),
      {} as never,
    );
    const { grant } = await json(created);
    as(MANAGER);
    const res = await grantsRoute.DELETE(req('DELETE', '/api/access/tag-grants', { id: grant.id, reason: REASON }), {} as never);
    expect(res.status).toBe(204);
    expect(tables.accessTagGrant).toEqual([]);
  });
});

describe('column search', () => {
  type ColumnModel = { findMany: ReturnType<typeof vi.fn> };
  const columnsModel = () => (db as unknown as { platformContextColumn: ColumnModel }).platformContextColumn;

  it('needs at least 2 characters', async () => {
    const res = await searchRoute.GET(req('GET', '/api/access/column-search?q=s'), {} as never);
    expect(res.status).toBe(400);
  });

  it('View can search; results carry existing tags, exact matches first, and skip non-table paths', async () => {
    const tagId = await makeTag();
    await columnTagsRoute.POST(
      req('POST', '/api/access/column-tags', { tablePath: 'main.hr.payroll', columns: ['salary'], tagId, reason: REASON }),
      {} as never,
    );
    columnsModel().findMany.mockResolvedValueOnce([
      { name: 'BASE_SALARY', data_type: 'decimal', object: { full_path: 'main.crew.contracts', object_kind: 'table' } },
      { name: 'salary', data_type: 'decimal', object: { full_path: 'main.hr.payroll', object_kind: 'table' } },
      { name: 'salary', data_type: 'decimal', object: { full_path: 'main.hr', object_kind: 'schema' } },
    ]);
    as(VIEWER);
    const res = await searchRoute.GET(req('GET', '/api/access/column-search?q=Salary'), {} as never);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.columns).toEqual([
      { tablePath: 'main.hr.payroll', column: 'salary', type: 'decimal', kind: 'table', tagIds: [tagId], match: 'name' },
      { tablePath: 'main.crew.contracts', column: 'base_salary', type: 'decimal', kind: 'table', tagIds: [], match: 'name' },
    ]);
    expect(columnsModel().findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { org_id: 'org', name: { contains: 'salary', mode: 'insensitive' } } }),
    );
  });

  it('people without Data access cannot search', async () => {
    as(MEMBER);
    const res = await searchRoute.GET(req('GET', '/api/access/column-search?q=salary'), {} as never);
    expect(res.status).toBe(403);
  });
});

describe('access rules (simplified model)', () => {
  const put = (body: unknown) => rulesRoute.PUT(req('PUT', '/api/access/rules', body), {} as never);

  it('Manage gives a group Use on a catalog; setting again replaces it', async () => {
    const groupId = await makeGroup();
    as(MANAGER);
    expect((await put({ holderType: 'group', holderId: groupId, path: 'Curated_DB', access: 'use', reason: REASON })).status).toBe(200);
    expect(tables.accessRule).toEqual([expect.objectContaining({ holder_type: 'group', holder_id: groupId, path: 'curated_db', path_depth: 1, effect: 'use', allow_export: false })]);
    await put({ holderType: 'group', holderId: groupId, path: 'curated_db', access: 'export', reason: REASON });
    expect(tables.accessRule).toEqual([expect.objectContaining({ effect: 'use', allow_export: true })]);
    await put({ holderType: 'group', holderId: groupId, path: 'curated_db', access: 'block', reason: REASON });
    expect(tables.accessRule).toEqual([expect.objectContaining({ effect: 'block' })]);
    await put({ holderType: 'group', holderId: groupId, path: 'curated_db', access: 'none', reason: REASON });
    expect(tables.accessRule).toEqual([]);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'access.rule.set' }));
  });

  it('built-in groups: Members works, an unknown role is refused', async () => {
    as(MANAGER);
    expect((await put({ holderType: 'builtin', holderId: 'member', path: 'curated_db', access: 'use', reason: REASON })).status).toBe(200);
    expect((await put({ holderType: 'builtin', holderId: 'nope', path: 'curated_db', access: 'use', reason: REASON })).status).toBe(404);
  });

  it('nobody gives Use to a group they are in, or to Admins, unless a platform admin (review: self-access)', async () => {
    const groupId = await makeGroup();
    tables.accessGroupMember!.push({ group_id: groupId, user_id: 'u-mgr', expires_at: null });
    as(MANAGER);
    expect((await put({ holderType: 'group', holderId: groupId, path: 'curated_db', access: 'use', reason: REASON })).status).toBe(403);
    expect((await put({ holderType: 'builtin', holderId: 'admin', path: 'curated_db', access: 'use', reason: REASON })).status).toBe(403);
    // Narrowing is still fine.
    expect((await put({ holderType: 'group', holderId: groupId, path: 'curated_db', access: 'block', reason: REASON })).status).toBe(200);
    as(PLATFORM_ADMIN);
    expect((await put({ holderType: 'builtin', holderId: 'admin', path: 'curated_db', access: 'use', reason: REASON })).status).toBe(200);
  });

  it('nobody sets their own access; View cannot set access; a reason is optional', async () => {
    expect((await put({ holderType: 'person', holderId: 'u-pa', path: 'curated_db', access: 'use', reason: REASON })).status).toBe(403);
    as(VIEWER);
    expect((await put({ holderType: 'person', holderId: 'u-ana', path: 'curated_db', access: 'use', reason: REASON })).status).toBe(403);
    as(MANAGER);
    expect((await put({ holderType: 'person', holderId: 'u-ana', path: 'curated_db', access: 'use' })).status).toBe(200);
  });

  it('catalog names with hyphens are accepted (real dev catalog synergymarine-export-prod)', async () => {
    as(MANAGER);
    expect((await put({ holderType: 'builtin', holderId: 'member', path: 'SynergyMarine-Export-Prod', access: 'use', reason: REASON })).status).toBe(200);
    expect(tables.accessRule).toEqual([expect.objectContaining({ path: 'synergymarine-export-prod' })]);
  });

  it('a path deeper than catalog.schema.table is refused', async () => {
    as(MANAGER);
    expect((await put({ holderType: 'person', holderId: 'u-ana', path: 'a.b.c.d', access: 'use', reason: REASON })).status).toBe(400);
  });
});

describe('whole-path protections', () => {
  it('Manage protects a schema; only a platform admin removes it', async () => {
    const tagId = await makeTag();
    as(MANAGER);
    const res = await pathProtectionsRoute.POST(req('POST', '/api/access/path-protections', { tagId, path: 'Main.HR', reason: REASON }), {} as never);
    expect(res.status).toBe(201);
    expect(tables.accessPathProtection).toEqual([expect.objectContaining({ tag_id: tagId, path: 'main.hr', path_depth: 2 })]);
    const del = () => pathProtectionsRoute.DELETE(req('DELETE', '/api/access/path-protections', { tagId, path: 'main.hr', reason: REASON }), {} as never);
    expect((await del()).status).toBe(403);
    as(PLATFORM_ADMIN);
    expect((await del()).status).toBe(204);
    expect(tables.accessPathProtection).toEqual([]);
  });

  it('protecting needs no reason, but removing a protection still does', async () => {
    const tagId = await makeTag();
    as(MANAGER);
    expect((await pathProtectionsRoute.POST(req('POST', '/api/access/path-protections', { tagId, path: 'main.hr' }), {} as never)).status).toBe(201);
    as(PLATFORM_ADMIN);
    expect((await pathProtectionsRoute.DELETE(req('DELETE', '/api/access/path-protections', { tagId, path: 'main.hr' }), {} as never)).status).toBe(400);
    expect(tables.accessPathProtection).toHaveLength(1);
  });
});
