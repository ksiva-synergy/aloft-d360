/**
 * Users → Section access (built-in role defaults) and Users → Permissions APIs, against an
 * in-memory roles/permissions store: only platform admins change anything, platform admin itself
 * cannot be changed, only editable keys move, and a saved change reaches resolveSectionLevels
 * through the role's keys exactly as a person's request would see it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSectionLevels } from '@/lib/sections/registry';

type KeyCond = string | { startsWith?: string; in?: string[] };
type Where = Record<string, unknown>;

const h = vi.hoisted(() => ({
  roles: new Map<string, { id: string; name: string; isSystem: boolean }>(),
  perms: new Map<string, { id: string; key: string; description: string | null }>(),
  links: [] as { roleId: string; permissionId: string }[],
  holders: new Map<string, string[]>(), // roleId → user ids
  resolveAuth: vi.fn(),
  audit: vi.fn(),
}));

function keyMatches(key: string, cond: KeyCond | undefined): boolean {
  if (cond === undefined) return true;
  if (typeof cond === 'string') return key === cond;
  if (cond.startsWith !== undefined && !key.startsWith(cond.startsWith)) return false;
  if (cond.in !== undefined && !cond.in.includes(key)) return false;
  return true;
}
function permMatches(key: string, where: Where | undefined): boolean {
  if (!where) return true;
  if (Array.isArray(where.OR)) return (where.OR as Where[]).some((w) => keyMatches(key, w.key as KeyCond));
  return keyMatches(key, where.key as KeyCond);
}
function nameMatches(name: string, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (typeof cond === 'string') return name === cond;
  const c = cond as { in?: string[]; not?: string };
  if (c.in && !c.in.includes(name)) return false;
  if (c.not !== undefined && name === c.not) return false;
  return true;
}
function linkRows(where: Where = {}) {
  return h.links
    .map((l) => ({ ...l, key: h.perms.get(l.permissionId)!.key, roleName: h.roles.get(l.roleId)!.name }))
    .filter((l) => (where.roleId === undefined || l.roleId === where.roleId))
    .filter((l) => nameMatches(l.roleName, (where.role as Where | undefined)?.name))
    .filter((l) => permMatches(l.key, where.permission as Where | undefined));
}

vi.mock('server-only', () => ({}));
vi.mock('@/middleware/auth', () => ({ resolveAuth: h.resolveAuth }));
vi.mock('@/lib/audit', () => ({ writeAudit: h.audit }));
vi.mock('@/lib/sections/bundles', async (orig) => ({ ...(await orig<object>()), listBundles: async () => [] }));
vi.mock('@/lib/db', () => {
  const prisma: Record<string, unknown> = {
    role: {
      findUnique: async ({ where }: { where: { id?: string; name?: string } }) =>
        [...h.roles.values()].find((r) => (where.id ? r.id === where.id : r.name === where.name)) ?? null,
      findMany: async ({ where }: { where: Where }) =>
        [...h.roles.values()]
          .filter((r) => nameMatches(r.name, where.name))
          .filter((r) => !where.OR || (where.OR as Where[]).some((o) => (o.name ? nameMatches(r.name, o.name) : r.isSystem === o.isSystem)))
          .map((r) => ({
            id: r.id,
            name: r.name,
            permissions: linkRows({ roleId: r.id, permission: { OR: [{ key: { in: [...h.perms.values()].map((p) => p.key).filter((k) => !k.startsWith('section')) } }, { key: { startsWith: 'section:role-base:' } }] } }).map((l) => ({ permission: { key: l.key } })),
            _count: { users: (h.holders.get(r.id) ?? []).length },
          })),
      update: async () => ({}),
    },
    permission: {
      upsert: async ({ where, create }: { where: { key: string }; create: { key: string; description: string } }) => {
        const found = [...h.perms.values()].find((p) => p.key === where.key);
        if (found) return found;
        const row = { id: `p-${create.key}`, key: create.key, description: create.description };
        h.perms.set(row.id, row);
        return row;
      },
      findMany: async ({ where }: { where: { key: { in: string[] } } }) => [...h.perms.values()].filter((p) => where.key.in.includes(p.key)),
    },
    rolePermission: {
      findMany: async ({ where }: { where: Where }) => linkRows(where).map((l) => ({ roleId: l.roleId, permission: { key: l.key } })),
      deleteMany: async ({ where }: { where: Where }) => {
        const drop = new Set(linkRows(where).map((l) => `${l.roleId}|${l.permissionId}`));
        h.links = h.links.filter((l) => !drop.has(`${l.roleId}|${l.permissionId}`));
        return { count: drop.size };
      },
      createMany: async ({ data }: { data: { roleId: string; permissionId: string }[] }) => {
        for (const d of data) if (!h.links.some((l) => l.roleId === d.roleId && l.permissionId === d.permissionId)) h.links.push(d);
        return { count: data.length };
      },
    },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});

import { GET as matrixGET } from '../route';
import { PUT as roleDefaultsPUT } from '../role-defaults/[role]/route';
import { GET as permissionsGET } from '../permissions/route';
import { PUT as permissionsPUT } from '../permissions/[roleId]/route';

const platformAdmin = { userId: 'u-pa', role: 'platform_admin', permissions: new Set<string>() };
const orgAdmin = { userId: 'u-admin', role: 'admin', permissions: new Set<string>() };

const put = (url: string, body: unknown) =>
  new Request(`http://test${url}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) }) as never;

/** What a person holding `roleName` would carry, as flattenPermissions builds it. */
const keysOf = (roleName: string) => linkRows({ role: { name: roleName } }).map((l) => l.key);

function seed() {
  h.roles.clear();
  h.perms.clear();
  h.links = [];
  h.holders.clear();
  for (const [name, isSystem] of [['platform_admin', true], ['admin', true], ['member', true], ['readonly', true], ['Analysts', false]] as const) {
    h.roles.set(`r-${name}`, { id: `r-${name}`, name, isSystem });
  }
  for (const key of ['inspector:use', 'session:read', 'session:read:all', 'section:build.automate:view']) h.perms.set(`p-${key}`, { id: `p-${key}`, key, description: null });
  h.links.push(
    { roleId: 'r-member', permissionId: 'p-inspector:use' },
    { roleId: 'r-member', permissionId: 'p-session:read' },
    { roleId: 'r-Analysts', permissionId: 'p-section:build.automate:view' },
  );
  h.holders.set('r-member', ['u-1', 'u-2']);
}

beforeEach(() => {
  seed();
  h.audit.mockReset();
  h.resolveAuth.mockReset();
  h.resolveAuth.mockResolvedValue(platformAdmin);
});

describe('built-in role defaults', () => {
  it('lets a platform admin change Member defaults, which then reach everyone with Member', async () => {
    expect(resolveSectionLevels(['member'], keysOf('member'))['build.automate']).toBe('none');
    const res = await roleDefaultsPUT(put('/api/sections/role-defaults/member', { levels: { 'build.automate': 'manage', 'build.agents': 'none' } }), params({ role: 'member' }));
    expect(res.status).toBe(200);
    expect((await res.json()).defaults).toMatchObject({ 'build.automate': 'manage', 'build.agents': 'none' });

    const levels = resolveSectionLevels(['member'], keysOf('member'));
    expect(levels['build.automate']).toBe('manage');
    expect(levels['build.agents']).toBe('none');
    // Other permissions on the role are untouched.
    expect(keysOf('member')).toEqual(expect.arrayContaining(['inspector:use', 'session:read']));
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'section_role_defaults.updated', entityId: 'member' }));
  });

  it('shows the change in the matrix, beside the shipped default', async () => {
    await roleDefaultsPUT(put('/api/sections/role-defaults/admin', { levels: { 'build.teach': 'none' } }), params({ role: 'admin' }));
    const json = await (await matrixGET(new Request('http://test/api/sections'), undefined)).json();
    const teach = json.sections.find((s: { id: string }) => s.id === 'build.teach');
    expect(teach.defaults.admin).toBe('none');
    expect(teach.builtInDefaults.admin).toBe('view');
    expect(json.roleOverrides.admin).toEqual({ 'build.teach': 'none' });
  });

  it('goes back to the shipped defaults when saved with them (nothing stored)', async () => {
    await roleDefaultsPUT(put('/api/sections/role-defaults/member', { levels: { 'build.automate': 'manage' } }), params({ role: 'member' }));
    await roleDefaultsPUT(put('/api/sections/role-defaults/member', { levels: { 'build.automate': 'none' } }), params({ role: 'member' }));
    expect(keysOf('member').filter((k) => k.startsWith('section-default:'))).toEqual([]);
  });

  it('refuses org admins, platform admin as a target, unknown roles and unknown sections', async () => {
    h.resolveAuth.mockResolvedValue(orgAdmin);
    expect((await roleDefaultsPUT(put('/x', { levels: {} }), params({ role: 'member' }))).status).toBe(403);
    h.resolveAuth.mockResolvedValue(platformAdmin);
    expect((await roleDefaultsPUT(put('/x', { levels: {} }), params({ role: 'platform_admin' }))).status).toBe(400);
    expect((await roleDefaultsPUT(put('/x', { levels: {} }), params({ role: 'owner' }))).status).toBe(404);
    expect((await roleDefaultsPUT(put('/x', { levels: { 'no.such': 'view' } }), params({ role: 'member' }))).status).toBe(400);
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe('role permissions', () => {
  it('lists built-in roles first, then custom roles and bundles, without platform admin', async () => {
    const json = await (await permissionsGET(new Request('http://test/api/sections/permissions'), undefined)).json();
    expect(json.canEdit).toBe(true);
    expect(json.roles.map((r: { name: string }) => r.name)).toEqual(['admin', 'member', 'readonly', 'Analysts']);
    expect(json.roles.find((r: { name: string }) => r.name === 'member')).toMatchObject({ kind: 'builtin', keys: ['inspector:use', 'session:read'], memberCount: 2 });
    expect(json.roles.find((r: { name: string }) => r.name === 'Analysts')).toMatchObject({ kind: 'bundle', keys: [] });
  });

  it('shows the list read-only to an org admin who can view Users', async () => {
    h.resolveAuth.mockResolvedValue(orgAdmin);
    const res = await permissionsGET(new Request('http://test/api/sections/permissions'), undefined);
    expect(res.status).toBe(200);
    expect((await res.json()).canEdit).toBe(false);
  });

  it('gives Admin the Automate publishing permissions and takes one away, leaving section keys alone', async () => {
    const res = await permissionsPUT(put('/api/sections/permissions/r-Analysts', { keys: ['connector:external', 'flow:sql'] }), params({ roleId: 'r-Analysts' }));
    expect(res.status).toBe(200);
    expect((await res.json()).role.keys).toEqual(['connector:external', 'flow:sql']);
    expect(keysOf('Analysts').sort()).toEqual(['connector:external', 'flow:sql', 'section:build.automate:view']);

    await permissionsPUT(put('/x', { keys: ['inspector:use'] }), params({ roleId: 'r-member' }));
    expect(keysOf('member')).toEqual(['inspector:use']);
    expect(h.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'role.permissions.updated', before: { name: 'member', keys: ['inspector:use', 'session:read'] }, after: { name: 'member', keys: ['inspector:use'] } }),
    );
  });

  it('refuses org admins, platform admin, unknown roles, unknown keys and platform-admin-only keys', async () => {
    h.resolveAuth.mockResolvedValue(orgAdmin);
    expect((await permissionsPUT(put('/x', { keys: [] }), params({ roleId: 'r-member' }))).status).toBe(403);
    h.resolveAuth.mockResolvedValue(platformAdmin);
    expect((await permissionsPUT(put('/x', { keys: [] }), params({ roleId: 'r-platform_admin' }))).status).toBe(400);
    expect((await permissionsPUT(put('/x', { keys: [] }), params({ roleId: 'r-nope' }))).status).toBe(404);
    expect((await permissionsPUT(put('/x', { keys: ['not:real'] }), params({ roleId: 'r-member' }))).status).toBe(400);
    const pa = await permissionsPUT(put('/x', { keys: ['session:read:all'] }), params({ roleId: 'r-member' }));
    expect(pa.status).toBe(400);
    expect((await pa.json()).error).toMatch(/platform admins/);
    expect(keysOf('member')).toEqual(['inspector:use', 'session:read']);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
