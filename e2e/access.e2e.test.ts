/**
 * Data access end to end on DEV: real API routes, real engine, real Prisma against the dev database.
 * Only sign-in is simulated (the test acts as real dev users). Everything is named E2E-TEST and
 * removed in afterAll, except request history (access_requests / access_request_events are
 * append-only by design; their reasons start with "E2E-TEST").
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ caller: null as null | { userId: string; role: string; permissions: Set<string> }, orgId: '' }));

vi.mock('@/middleware/auth', () => ({
  resolveAuth: vi.fn(async () => {
    if (!state.caller) throw new Error('no caller');
    return state.caller;
  }),
  authenticateSession: vi.fn(async () => state.caller),
}));
vi.mock('@/lib/databricks/connections', () => ({ getOrgId: vi.fn(async () => state.orgId) }));

import { prisma } from '@/lib/db';
import { principalForUser } from '@/lib/access/principal';
import { getAccessModel, evictAccessModel } from '@/lib/access/model-store';
import { authorizeWithModel } from '@/lib/access/engine';
import { applyMask, planColumnGuard } from '@/lib/access/column-guard';
import { stripProtectedValues } from '@/lib/access/describe-filter';
import { runMaintenance } from '@/lib/access/request-maintenance';
import * as tagsRoute from '@/app/api/access/tags/route';
import * as groupsRoute from '@/app/api/access/groups/route';
import * as membersRoute from '@/app/api/access/groups/[id]/members/route';
import * as grantsRoute from '@/app/api/access/tag-grants/route';
import * as columnTagsRoute from '@/app/api/access/column-tags/route';
import * as rulesRoute from '@/app/api/access/rules/route';
import * as pathProtRoute from '@/app/api/access/path-protections/route';
import * as requestsRoute from '@/app/api/access/requests/route';
import * as requestRoute from '@/app/api/access/requests/[id]/route';
import * as dataTreeRoute from '@/app/api/access/data-tree/route';
import * as personRoute from '@/app/api/access/person/route';
import * as myAccessRoute from '@/app/api/access/my-access/route';
import * as notificationsRoute from '@/app/api/access/notifications/route';
import * as columnSearchRoute from '@/app/api/access/column-search/route';
import * as columnInfoRoute from '@/app/api/access/column-info/route';

const CAT = 'e2e_test_cat';
const TABLE = `${CAT}.hr.payroll`;
const SECRET = `${CAT}.secret`;
const WHY = 'E2E-TEST: automated end-to-end check of the access flow';
/** Unique per run: archived test protections keep their key (request history points at them). */
const RUN = Date.now().toString(36);

const U: Record<'pa' | 'owner' | 'member' | 'requester' | 'auto', { id: string; email: string }> = {
  pa: { id: '', email: 'senthilnathan.s@synergyship.com' },
  owner: { id: '', email: 'chandru.k@synergyship.com' },
  member: { id: '', email: 'subhasini.d@synergyship.com' },
  requester: { id: '', email: 'avinash.sakthivel@synergyship.com' },
  auto: { id: '', email: 'yukeshkumar.v@synergyship.com' },
};
const ids = { tag: '', group: '', requests: [] as string[] };

function as(who: keyof typeof U) {
  state.caller = { userId: U[who].id, role: who === 'pa' ? 'platform_admin' : 'member', permissions: new Set() };
}
const call = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => (res.status === 204 ? null : res.json());
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function cleanup() {
  const tags = await prisma.accessTag.findMany({ where: { org_id: state.orgId, key: { startsWith: 'e2e_test' } }, select: { id: true } });
  const groups = await prisma.accessGroup.findMany({ where: { org_id: state.orgId, key: { startsWith: 'e2e_test' } }, select: { id: true } });
  const testRequests = await prisma.accessRequest.findMany({ where: { org_id: state.orgId, reason: { startsWith: 'E2E-TEST' } }, select: { id: true } });
  await prisma.accessNotification.deleteMany({ where: { request_id: { in: testRequests.map((r) => r.id) } } });
  await prisma.accessRule.deleteMany({ where: { org_id: state.orgId, path: { startsWith: CAT } } });
  await prisma.accessRule.deleteMany({ where: { org_id: state.orgId, holder_type: 'group', holder_id: { in: groups.map((g) => g.id) } } });
  await prisma.accessTagGrant.deleteMany({ where: { tag_id: { in: tags.map((t) => t.id) } } });
  await prisma.accessColumnTag.deleteMany({ where: { tag_id: { in: tags.map((t) => t.id) } } });
  await prisma.accessPathProtection.deleteMany({ where: { tag_id: { in: tags.map((t) => t.id) } } });
  await prisma.accessGroupMember.deleteMany({ where: { group_id: { in: groups.map((g) => g.id) } } });
  await prisma.accessGroupOwner.deleteMany({ where: { group_id: { in: groups.map((g) => g.id) } } });
  await prisma.accessGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
  // Protections referenced by request history cannot be deleted (by design); archive them instead.
  await prisma.accessTag.updateMany({ where: { id: { in: tags.map((t) => t.id) }, archived_at: null }, data: { archived_at: new Date() } });
  evictAccessModel(state.orgId);
}

beforeAll(async () => {
  process.env.COLUMN_ACCESS_MODE = 'enforce';
  const org = process.env.DEFAULT_ORG_ID?.trim()
    ? { id: process.env.DEFAULT_ORG_ID.trim() }
    : await prisma.platformOrg.findFirst({ where: process.env.DEFAULT_ORG_SLUG ? { slug: process.env.DEFAULT_ORG_SLUG } : {}, select: { id: true } });
  state.orgId = org!.id;
  for (const k of Object.keys(U) as (keyof typeof U)[]) {
    const u = await prisma.user.findFirst({ where: { email: U[k].email }, select: { id: true } });
    if (!u) throw new Error(`missing dev user ${U[k].email}`);
    U[k].id = u.id;
  }
  await cleanup(); // leftovers from an earlier run
});

afterAll(async () => {
  await cleanup();
  delete process.env.COLUMN_ACCESS_MODE;
  await prisma.$disconnect();
});

describe('data access end to end (dev)', () => {
  it('1. a platform admin creates a protection, a group with an approver, and gives the group the protection', async () => {
    as('pa');
    const tag = await json(await tagsRoute.POST(call('POST', '/api/access/tags', { key: `e2e_test_pay_${RUN}`, name: 'E2E-TEST Pay', reason: WHY }), {} as never));
    ids.tag = tag.tag.id;
    const group = await json(await groupsRoute.POST(call('POST', '/api/access/groups', { key: `e2e_test_payroll_${RUN}`, name: 'E2E-TEST Payroll', ownerIds: [U.owner.id], reason: WHY }), {} as never));
    ids.group = group.group.id;
    const g = await grantsRoute.POST(call('POST', '/api/access/tag-grants', { tagId: ids.tag, principalType: 'group', principalId: ids.group, level: 'full', reason: WHY }), {} as never);
    expect(g.status).toBe(201);
  });

  it('2. the approver adds a member; nobody adds themselves', async () => {
    as('owner');
    expect((await membersRoute.POST(call('POST', 'x', { userId: U.member.id, reason: WHY }), params(ids.group))).status).toBe(201);
    expect((await membersRoute.POST(call('POST', 'x', { userId: U.owner.id, reason: WHY }), params(ids.group))).status).toBe(403);
  });

  it('3. columns and a whole schema are protected; Members can use the catalog', async () => {
    as('pa');
    expect((await columnTagsRoute.POST(call('POST', 'x', { tablePath: TABLE, columns: ['salary'], tagId: ids.tag, reason: WHY }), {} as never)).status).toBe(201);
    expect((await pathProtRoute.POST(call('POST', 'x', { tagId: ids.tag, path: SECRET, reason: WHY }), {} as never)).status).toBe(201);
    expect((await rulesRoute.PUT(call('PUT', 'x', { holderType: 'builtin', holderId: 'member', path: CAT, access: 'use', reason: WHY }), {} as never)).status).toBe(200);
  });

  it('4. table access: Members open the catalog; the protected schema needs the protection; other catalogs stay closed', async () => {
    const { model } = await getAccessModel(state.orgId);
    const requester = await principalForUser(U.requester.id, state.orgId);
    const member = await principalForUser(U.member.id, state.orgId);
    expect(authorizeWithModel(model, requester, [TABLE], 'query')).toMatchObject({ ok: true });
    expect(authorizeWithModel(model, requester, [`${SECRET}.t`], 'query')).toMatchObject({ ok: false, reason: 'needs_clearance' });
    expect(authorizeWithModel(model, requester, ['e2e_nowhere.x.y'], 'query')).toMatchObject({ ok: false, reason: 'no_grant' });
    expect(authorizeWithModel(model, member, [`${SECRET}.t`], 'query')).toMatchObject({ ok: true });
    expect(authorizeWithModel(model, requester, [TABLE], 'export')).toMatchObject({ ok: false });
  });

  it('5. columns: masked for the requester, refused when filtered, full for the group member; values never leak', async () => {
    const requester = await principalForUser(U.requester.id, state.orgId);
    const member = await principalForUser(U.member.id, state.orgId);
    const masked = await planColumnGuard(requester, `SELECT * FROM ${TABLE}`, [TABLE]);
    expect(masked.maskIndexes).toEqual([{ index: 0, name: 'salary' }]);
    expect(masked.note?.message).toContain("you don't have access to E2E-TEST Pay data");
    const out = applyMask({ columns: [{ name: 'salary', type_name: 'DECIMAL' }], rows: [{ salary: 123456.78 }], row_count: 1, statement_id: 's', truncated: false }, masked);
    expect(JSON.stringify(out)).not.toContain('123456');
    expect((await planColumnGuard(requester, `SELECT 1 AS n FROM ${TABLE} WHERE salary > 100`, [TABLE])).stop).toContain("You can't filter");
    expect((await planColumnGuard(member, `SELECT * FROM ${TABLE} ORDER BY salary`, [TABLE])).maskIndexes).toEqual([]);
    const { model } = await getAccessModel(state.orgId);
    const desc = { full_path: TABLE, columns: [{ name: 'salary', min: 1, max: 999999 }] };
    expect(stripProtectedValues(desc, model, { userId: U.requester.id, roles: ['member'] })).toBe(2);
  });

  it('6. the requester asks; it goes to the approver, who is notified; the right people can decide', async () => {
    as('requester');
    const res = await requestsRoute.POST(call('POST', '/api/access/requests', { targetType: 'tag', tagId: ids.tag, level: 'full', durationDays: 30, reason: WHY }), {} as never);
    expect(res.status).toBe(201);
    const r = await prisma.accessRequest.findFirst({ where: { requester_id: U.requester.id, tag_id: ids.tag }, orderBy: { created_at: 'desc' } });
    ids.requests.push(r!.id);
    expect(r!.routed_to).toEqual([U.owner.id]);
    expect(await prisma.accessNotification.count({ where: { request_id: r!.id, user_id: U.owner.id, kind: 'routed' } })).toBe(1);
    expect((await requestRoute.POST(call('POST', 'x', { action: 'approve' }), params(r!.id))).status).toBe(403); // own request
    as('member');
    expect((await requestRoute.POST(call('POST', 'x', { action: 'approve' }), params(r!.id))).status).toBe(403); // not routed
  });

  it('7. the approver narrows the time and approves; access works on the next query; history is complete', async () => {
    const id = ids.requests[0]!;
    as('owner');
    expect((await requestRoute.POST(call('POST', 'x', { action: 'approve', durationDays: 90 }), params(id))).status).toBe(400); // longer than asked
    const ok = await requestRoute.POST(call('POST', 'x', { action: 'approve', durationDays: 7, comment: 'E2E-TEST ok' }), params(id));
    expect(ok.status).toBe(200);
    const grant = await prisma.accessTagGrant.findFirst({ where: { tag_id: ids.tag, principal_type: 'user', principal_id: U.requester.id } });
    expect(grant!.expires_at!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(grant!.expires_at!.getTime()).toBeLessThan(Date.now() + 8 * 86_400_000);
    const requester = await principalForUser(U.requester.id, state.orgId);
    expect((await planColumnGuard(requester, `SELECT * FROM ${TABLE}`, [TABLE])).maskIndexes).toEqual([]);
    const events = await prisma.accessRequestEvent.findMany({ where: { request_id: id }, orderBy: { ts: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['requested', 'routed', 'approved_with_changes', 'granted']);
    expect(await prisma.accessNotification.count({ where: { request_id: id, user_id: U.requester.id, kind: 'approved' } })).toBe(1);
  });

  it('8. the history cannot be edited or deleted (database trigger)', async () => {
    const id = ids.requests[0]!;
    await expect(prisma.accessRequestEvent.updateMany({ where: { request_id: id }, data: { comment: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma.accessRequestEvent.deleteMany({ where: { request_id: id } })).rejects.toThrow(/append-only/);
  });

  it('9. auto-approve: a rule with auto-approve grants an unprotected table at once, never a protected one', async () => {
    as('pa');
    await rulesRoute.PUT(call('PUT', 'x', { holderType: 'builtin', holderId: 'member', path: CAT, access: 'use', autoApprove: true, reason: WHY }), {} as never);
    as('auto');
    const res = await json(await requestsRoute.POST(call('POST', 'x', { targetType: 'path', path: `${CAT}.ops.voyages`, level: 'query', durationDays: 7, reason: WHY }), {} as never));
    expect(res.request).toMatchObject({ status: 'approved', autoApproved: true });
    expect(await prisma.accessRule.count({ where: { holder_type: 'person', holder_id: U.auto.id, path: `${CAT}.ops.voyages` } })).toBe(1);
    const prot = await json(await requestsRoute.POST(call('POST', 'x', { targetType: 'path', path: `${SECRET}.t`, level: 'query', durationDays: 7, reason: WHY }), {} as never));
    expect(prot.request).toMatchObject({ status: 'pending', autoApproved: false });
    ids.requests.push(prot.request.id);
  });

  it('10. housekeeping: escalates after 3 days, expires after 14', async () => {
    const id = ids.requests[1]!;
    await prisma.accessRequest.update({ where: { id }, data: { created_at: new Date(Date.now() - 4 * 86_400_000) } });
    const first = await runMaintenance(state.orgId);
    expect(first.escalate).toBeGreaterThanOrEqual(1);
    expect(await prisma.accessRequestEvent.count({ where: { request_id: id, type: 'escalated' } })).toBe(1);
    await prisma.accessRequest.update({ where: { id }, data: { created_at: new Date(Date.now() - 15 * 86_400_000) } });
    await runMaintenance(state.orgId);
    expect((await prisma.accessRequest.findUnique({ where: { id } }))!.status).toBe('expired');
  });

  it('12. search by meaning: finds pay columns whose names differ, and never returns stored text or sample values', async () => {
    as('pa');
    const res = await json(await columnSearchRoute.GET(call('GET', '/api/access/column-search?q=salary&by=meaning'), {} as never));
    expect(res.columns.length).toBeGreaterThan(0);
    expect(res.columns.every((c: { match: string }) => c.match === 'meaning')).toBe(true);
    const text = JSON.stringify(res);
    expect(text).not.toContain('Sample values');
    expect(text).not.toContain('embed_text');
    // At least one hit whose name does not contain "salary" (what name search would miss).
    expect(res.columns.some((c: { column: string }) => !c.column.includes('salary'))).toBe(true);
    as('requester');
    expect((await columnSearchRoute.GET(call('GET', '/api/access/column-search?q=salary&by=meaning'), {} as never)).status).toBe(403);
    const mine = await json(await myAccessRoute.GET(call('GET', '/api/access/my-access?q=crew%20medical&by=meaning'), {} as never));
    expect(JSON.stringify(mine)).not.toContain('Sample values');
  });

  it('13. ⓘ column info on a real column: where it is, description, values; admins only', async () => {
    as('pa');
    const found = await json(await columnSearchRoute.GET(call('GET', '/api/access/column-search?q=revised_salary'), {} as never));
    const hit = found.columns[0] as { tablePath: string; column: string };
    expect(hit).toBeTruthy();
    const info = await json(await columnInfoRoute.GET(call('GET', `/api/access/column-info?table=${encodeURIComponent(hit.tablePath)}&column=${hit.column}`), {} as never));
    expect(info.where.path).toBe(hit.tablePath);
    expect(info.column.name.toLowerCase()).toBe(hit.column);
    expect(info.profile).toHaveProperty('topValues');
    expect(info.harvested).toHaveProperty('structure');
    as('requester');
    expect((await columnInfoRoute.GET(call('GET', `/api/access/column-info?table=${encodeURIComponent(hit.tablePath)}&column=${hit.column}`), {} as never)).status).toBe(403);
  });

  it('11. read screens: data tree, person summary, my access, my requests, inbox, history, notifications', async () => {
    as('pa');
    const tree = await json(await dataTreeRoute.GET(call('GET', '/api/access/data-tree'), {} as never));
    const node = tree.nodes.find((n: { path: string }) => n.path === CAT);
    expect(node.access.rules.map((r: { holderName: string; autoApprove: boolean }) => [r.holderName, r.autoApprove])).toEqual([['Members', true]]);
    const person = await json(await personRoute.GET(call('GET', `/api/access/person?userId=${U.requester.id}`), {} as never));
    expect(person.protections.find((p: { id: string }) => p.id === ids.tag)).toMatchObject({ level: 'full', through: ['directly'] });
    as('requester');
    const mine = await json(await myAccessRoute.GET(call('GET', '/api/access/my-access'), {} as never));
    expect(mine.protections.find((p: { id: string }) => p.id === ids.tag)).toMatchObject({ myLevel: 'full' });
    const myReqs = await json(await requestsRoute.GET(call('GET', '/api/access/requests?view=mine'), {} as never));
    expect(myReqs.requests.some((r: { id: string; status: string }) => r.id === ids.requests[0] && r.status === 'approved')).toBe(true);
    const notes = await json(await notificationsRoute.GET(call('GET', '/api/access/notifications'), {} as never));
    expect(notes.notifications.some((n: { kind: string }) => n.kind === 'approved')).toBe(true);
    as('requester');
    expect((await requestsRoute.GET(call('GET', '/api/access/requests?view=history&days=30'), {} as never)).status).toBe(403);
    as('pa');
    const hist = await json(await requestsRoute.GET(call('GET', '/api/access/requests?view=history&days=90'), {} as never));
    expect(hist.requests.filter((r: { reason: string }) => r.reason.startsWith('E2E-TEST')).length).toBeGreaterThanOrEqual(3);
  });
});
