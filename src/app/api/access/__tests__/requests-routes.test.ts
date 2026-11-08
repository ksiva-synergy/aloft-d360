/**
 * Access requests (S4): ask → route → decide → grant, with the append-only history.
 * Edges mocked (auth, Prisma, audit, org id); routing, rules and grants run for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const { db, state, writeAudit } = vi.hoisted(() => {
  const state = { caller: { userId: 'u-ana', role: 'member', permissions: new Set<string>() } as { userId: string; role: string; permissions: Set<string> } };
  const tables: Record<string, Row[]> = {};
  let seq = 0;
  const cond = (v: any, x: any): boolean => {
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('in' in v) return v.in.includes(x);
      if ('has' in v) return Array.isArray(x) && x.includes(v.has);
      if ('gte' in v) return x >= v.gte;
      if ('not' in v) return x !== v.not;
      return matches(x ?? {}, v);
    }
    return x === v;
  };
  function matches(row: Row, where?: Row): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === 'NOT') return !matches(row, v);
      if (v === undefined) return true;
      // compound unique keys: { a_b_c: { a, b, c } }
      if (k.includes('_') && v && typeof v === 'object' && !(v instanceof Date) && !('in' in v) && !('has' in v) && !('gte' in v) && !('not' in v) && !(k in row)) return matches(row, v);
      return cond(v, row[k]);
    });
  }
  function model(name: string, defaults: () => Row = () => ({})) {
    tables[name] = [];
    const rows = () => tables[name]!;
    return {
      findMany: vi.fn(async (a?: { where?: Row }) => rows().filter((r) => matches(r, a?.where))),
      findFirst: vi.fn(async (a?: { where?: Row; orderBy?: Row }) => {
        const list = rows().filter((r) => matches(r, a?.where));
        return (a?.orderBy ? [...list].reverse() : list)[0] ?? null;
      }),
      findUnique: vi.fn(async (a: { where: Row }) => rows().find((r) => matches(r, a.where)) ?? null),
      count: vi.fn(async (a?: { where?: Row }) => rows().filter((r) => matches(r, a?.where)).length),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `${name}-${++seq}`, seq: BigInt(seq), ...defaults(), ...data };
        rows().push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = rows().find((r) => matches(r, where))!;
        Object.assign(row, data, { updated_at: new Date() });
        return row;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const row = rows().find((r) => matches(r, where));
        if (row) return Object.assign(row, update);
        const c = { id: `${name}-${++seq}`, ...defaults(), ...create };
        rows().push(c);
        return c;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = rows().length;
        tables[name] = rows().filter((r) => !matches(r, where));
        return { count: before - tables[name]!.length };
      }),
    };
  }
  const now = () => ({ created_at: new Date(), updated_at: new Date() });
  const db: Record<string, any> = {
    tables,
    accessTag: model('accessTag', () => ({ archived_at: null, requires_two_approvals: false })),
    accessTagGrant: model('accessTagGrant'),
    accessRule: model('accessRule'),
    accessGroup: model('accessGroup', () => ({ archived_at: null })),
    accessGroupOwner: model('accessGroupOwner'),
    accessRequest: model('accessRequest', () => ({ ...now(), status: 'pending', routed_to: [], decided_by: null, decided_at: null, granted_until: null, ticket_ref: null })),
    accessRequestEvent: model('accessRequestEvent', () => ({ ts: new Date() })),
    accessPolicyVersion: model('accessPolicyVersion'),
    userRole: model('userRole'),
    user: model('user'),
    accessPathProtection: model('accessPathProtection'),
    accessNotification: model('accessNotification'),
  };
  db.accessNotification.createMany = vi.fn(async ({ data }: { data: Row[] }) => {
    for (const d of data) {
      if (!tables.accessNotification!.some((n) => n.request_id === d.request_id && n.user_id === d.user_id && n.kind === d.kind)) tables.accessNotification!.push({ ...d });
    }
    return { count: data.length };
  });
  db.accessPolicyVersion.findUnique = vi.fn(async () => ({ version: BigInt(1) }));
  db.accessPolicyVersion.upsert = vi.fn(async () => ({ version: BigInt(2) }));
  db.userRole.findMany = vi.fn(async () => tables.userRole!.map((r) => ({ userId: r.userId })));
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

import * as listRoute from '../requests/route';
import * as oneRoute from '../requests/[id]/route';

const tables = db.tables as Record<string, Row[]>;
const ANA = { userId: 'u-ana', role: 'member', permissions: new Set<string>() };
const OWNER = { userId: 'u-owner', role: 'member', permissions: new Set<string>() };
const PA = { userId: 'u-pa', role: 'platform_admin', permissions: new Set<string>() };
const OTHER = { userId: 'u-other', role: 'member', permissions: new Set<string>() };
const as = (c: typeof ANA) => (state.caller = c);
const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const WHY = 'Q4 crew cost review for Fleet B, ticket FIN-221';

async function ask(body: Row) {
  return listRoute.POST(req('POST', '/api/access/requests', body), {} as never);
}
async function act(id: string, body: Row) {
  return oneRoute.POST(req('POST', `/api/access/requests/${id}`, body), params(id));
}

beforeEach(() => {
  for (const k of Object.keys(tables)) tables[k] = [];
  tables.userRole!.push({ userId: 'u-pa' });
  tables.accessTag!.push({ id: 'comp', org_id: 'org', name: 'Compensation', archived_at: null, requires_two_approvals: false });
  tables.accessTag!.push({ id: 'med', org_id: 'org', name: 'Medical', archived_at: null, requires_two_approvals: true });
  tables.accessGroup!.push({ id: 'payroll', org_id: 'org', archived_at: null });
  tables.accessGroupOwner!.push({ group_id: 'payroll', user_id: 'u-owner' });
  tables.accessTagGrant!.push({ org_id: 'org', tag_id: 'comp', principal_type: 'group', principal_id: 'payroll', level: 'full' });
  tables.accessTagGrant!.push({ org_id: 'org', tag_id: 'med', principal_type: 'group', principal_id: 'payroll', level: 'full' });
  tables.accessRule!.push({ org_id: 'org', holder_type: 'group', holder_id: 'payroll', path: 'curated_db', effect: 'use' });
  writeAudit.mockClear();
  as(ANA);
});

const events = (id: string) => tables.accessRequestEvent!.filter((e) => e.request_id === id).map((e) => e.type);

describe('asking', () => {
  it('a protection request is routed to the owners of groups that hold it', async () => {
    const res = await ask({ targetType: 'tag', tagId: 'comp', level: 'full', durationDays: 30, reason: WHY });
    expect(res.status).toBe(201);
    const r = tables.accessRequest![0]!;
    expect(r.routed_to).toEqual(['u-owner']);
    expect(events(r.id)).toEqual(['requested', 'routed']);
  });

  it('a table request is routed to owners of groups whose Use covers it', async () => {
    await ask({ targetType: 'path', path: 'Curated_DB.HR.Payroll', level: 'query', durationDays: 7, reason: WHY });
    expect(tables.accessRequest![0]).toMatchObject({ path: 'curated_db.hr.payroll', routed_to: ['u-owner'] });
  });

  it('nobody covering it → platform admins', async () => {
    await ask({ targetType: 'path', path: 'finance_db', level: 'query', reason: WHY });
    expect(tables.accessRequest![0]!.routed_to).toEqual(['u-pa']);
    expect(tables.accessRequest![0]!.duration_days).toBe(30); // default
  });

  it('two-approval protections: owner and platform admin; no permanent access', async () => {
    expect((await ask({ targetType: 'tag', tagId: 'med', level: 'full', durationDays: null, reason: WHY })).status).toBe(400);
    await ask({ targetType: 'tag', tagId: 'med', level: 'full', durationDays: 7, reason: WHY });
    expect(tables.accessRequest![0]!.routed_to.sort()).toEqual(['u-owner', 'u-pa']);
  });

  it('a short reason, a wrong level, or a duplicate open request is refused', async () => {
    expect((await ask({ targetType: 'tag', tagId: 'comp', level: 'full', reason: 'need it' })).status).toBe(400);
    expect((await ask({ targetType: 'tag', tagId: 'comp', level: 'query', reason: WHY })).status).toBe(400);
    await ask({ targetType: 'tag', tagId: 'comp', level: 'full', reason: WHY });
    expect((await ask({ targetType: 'tag', tagId: 'comp', level: 'full', reason: WHY })).status).toBe(409);
  });
});

describe('deciding', () => {
  async function newRequest(body: Row = { targetType: 'tag', tagId: 'comp', level: 'full', durationDays: 30, reason: WHY }) {
    as(ANA);
    await ask(body);
    return tables.accessRequest!.at(-1)!.id as string;
  }

  it('the owner approves: Ana gets the protection directly, with an end date, and history records it', async () => {
    const id = await newRequest();
    as(OWNER);
    const res = await act(id, { action: 'approve', comment: 'ok for Q4' });
    expect(res.status).toBe(200);
    const g = tables.accessTagGrant!.find((x) => x.principal_type === 'user' && x.principal_id === 'u-ana');
    expect(g).toMatchObject({ tag_id: 'comp', level: 'full' });
    expect(g!.expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(tables.accessRequest![0]).toMatchObject({ status: 'approved', decided_by: 'u-owner' });
    expect(events(id)).toEqual(['requested', 'routed', 'approved', 'granted']);
  });

  it('approve with changes: narrower level and shorter time only', async () => {
    const id = await newRequest();
    as(OWNER);
    expect((await act(id, { action: 'approve', durationDays: 90 })).status).toBe(400);
    await act(id, { action: 'approve', level: 'aggregate', durationDays: 7 });
    expect(tables.accessTagGrant!.find((x) => x.principal_id === 'u-ana')).toMatchObject({ level: 'aggregate' });
    expect(events(id)).toContain('approved_with_changes');
  });

  it('a table approval creates a Use rule for the person', async () => {
    const id = await newRequest({ targetType: 'path', path: 'curated_db.hr', level: 'export', durationDays: 7, reason: WHY });
    as(OWNER);
    await act(id, { action: 'approve' });
    expect(tables.accessRule!.find((r) => r.holder_type === 'person')).toMatchObject({ holder_id: 'u-ana', path: 'curated_db.hr', effect: 'use', allow_export: true });
  });

  it('nobody decides their own request; people it is not routed to cannot decide', async () => {
    const id = await newRequest();
    as(ANA);
    expect((await act(id, { action: 'approve' })).status).toBe(403);
    as(OTHER);
    expect((await act(id, { action: 'approve' })).status).toBe(403);
  });

  it('ask for information → requester answers → back to pending; reject needs a reason', async () => {
    const id = await newRequest();
    as(OWNER);
    await act(id, { action: 'ask_info', comment: 'Which vessels?' });
    expect(tables.accessRequest![0]!.status).toBe('info_requested');
    as(ANA);
    await act(id, { action: 'info_given', comment: 'Fleet B only' });
    expect(tables.accessRequest![0]!.status).toBe('pending');
    as(OWNER);
    expect((await act(id, { action: 'reject', comment: '' })).status).toBe(400);
    await act(id, { action: 'reject', comment: 'Use the totals report instead' });
    expect(tables.accessRequest![0]!.status).toBe('rejected');
    expect(events(id)).toEqual(['requested', 'routed', 'info_asked', 'info_given', 'rejected']);
  });

  it('two approvals: the owner alone records an approval; the platform admin completes it', async () => {
    const id = await newRequest({ targetType: 'tag', tagId: 'med', level: 'full', durationDays: 7, reason: WHY });
    as(OWNER);
    const first = await act(id, { action: 'approve' });
    expect(await first.json()).toMatchObject({ waitingForSecondApproval: true });
    expect(tables.accessTagGrant!.some((x) => x.principal_id === 'u-ana')).toBe(false);
    expect((await act(id, { action: 'approve' })).status).toBe(409); // same person again
    as(PA);
    await act(id, { action: 'approve' });
    expect(tables.accessTagGrant!.find((x) => x.principal_id === 'u-ana')).toMatchObject({ tag_id: 'med' });
    expect(events(id)).toEqual(['requested', 'routed', 'approval_recorded', 'approved', 'granted']);
  });

  it('a closed request cannot be decided again; the requester can cancel an open one', async () => {
    const id = await newRequest();
    as(ANA);
    await act(id, { action: 'cancel' });
    as(OWNER);
    expect((await act(id, { action: 'approve' })).status).toBe(409);
  });
});

describe('lists', () => {
  it('mine, inbox and history views', async () => {
    await ask({ targetType: 'tag', tagId: 'comp', level: 'full', reason: WHY });
    as(ANA);
    const mine = await (await listRoute.GET(req('GET', '/api/access/requests?view=mine'), {} as never)).json();
    expect(mine.requests).toHaveLength(1);
    expect(mine.requests[0]).toMatchObject({ number: expect.stringMatching(/^ACC-/), target: 'Compensation', canDecide: false });
    as(OWNER);
    const inbox = await (await listRoute.GET(req('GET', '/api/access/requests?view=inbox'), {} as never)).json();
    expect(inbox.requests[0]).toMatchObject({ canDecide: true });
    as(OTHER);
    expect((await (await listRoute.GET(req('GET', '/api/access/requests?view=inbox'), {} as never)).json()).requests).toHaveLength(0);
    // History needs Data access (members have none by default).
    expect((await listRoute.GET(req('GET', '/api/access/requests?view=history&days=30'), {} as never)).status).toBe(403);
    as(PA);
    const hist = await (await listRoute.GET(req('GET', '/api/access/requests?view=history&days=365'), {} as never)).json();
    expect(hist.requests).toHaveLength(1);
  });
});

describe('auto-approve and notifications', () => {
  it('approvers are notified when a request is routed; the requester when it is decided', async () => {
    await ask({ targetType: 'tag', tagId: 'comp', level: 'full', reason: WHY });
    const id = tables.accessRequest![0]!.id;
    expect(tables.accessNotification!.map((n) => [n.user_id, n.kind])).toEqual([['u-owner', 'routed']]);
    as(OWNER);
    await act(id, { action: 'approve' });
    expect(tables.accessNotification!.some((n) => n.user_id === 'u-ana' && n.kind === 'approved')).toBe(true);
  });

  it('a rule with auto-approve approves an unprotected table request at once', async () => {
    tables.accessRule!.push({ org_id: 'org', holder_type: 'builtin', holder_id: 'member', path: 'ops', effect: 'use', allow_export: false, auto_approve: true });
    const res = await ask({ targetType: 'path', path: 'ops.fleet.voyages', level: 'query', durationDays: 7, reason: WHY });
    expect(await res.json()).toMatchObject({ request: { status: 'approved', autoApproved: true } });
    expect(tables.accessRule!.find((r) => r.holder_type === 'person')).toMatchObject({ holder_id: 'u-ana', path: 'ops.fleet.voyages' });
    expect(events(tables.accessRequest![0]!.id)).toEqual(['requested', 'routed', 'approved', 'granted']);
  });

  it('auto-approve never covers export without allow_export, or protected paths', async () => {
    tables.accessRule!.push({ org_id: 'org', holder_type: 'builtin', holder_id: 'member', path: 'ops', effect: 'use', allow_export: false, auto_approve: true });
    tables.accessPathProtection!.push({ org_id: 'org', tag_id: 'comp', path: 'ops.hr' });
    await ask({ targetType: 'path', path: 'ops.fleet.voyages', level: 'export', durationDays: 7, reason: WHY });
    await ask({ targetType: 'path', path: 'ops.hr.payroll', level: 'query', durationDays: 7, reason: WHY });
    expect(tables.accessRequest!.map((r) => r.status)).toEqual(['pending', 'pending']);
  });
});
