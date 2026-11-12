import { prisma } from '@/lib/db';
import { effectiveDataRoles, loadUserRoleNames } from './roles';
import { BUILTIN_GROUPS, PLATFORM_ADMIN_ROLE, protectionLevel } from './engine';
import { getAccessModel } from './model-store';
import { loadAccessAdminData } from './rules-admin';

/** What one person can use and see, and through which group or rule (simplified model). */
export async function personAccessSummary(orgId: string, userId: string) {
  const [roles, { model }, data, groups] = await Promise.all([
    loadUserRoleNames(userId),
    getAccessModel(orgId),
    loadAccessAdminData(orgId),
    prisma.accessGroup.findMany({ where: { org_id: orgId, archived_at: null }, select: { id: true, name: true } }),
  ]);
  const now = Date.now();
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const memberships = (model.membersByUser.get(userId) ?? []).filter((m) => groupName.has(m.groupId));
  const activeGroups = new Set(memberships.filter((m) => !m.expiresAt || m.expiresAt.getTime() > now).map((m) => m.groupId));
  const dataRoles = new Set(effectiveDataRoles(roles));
  const builtins = BUILTIN_GROUPS.filter((b) => dataRoles.has(b.id));

  const via = (type: string, id: string): string | null => {
    if (type === 'person') return id === userId ? 'directly' : null;
    if (type === 'group') return activeGroups.has(id) ? `group ${groupName.get(id)}` : null;
    return dataRoles.has(id) ? `built-in ${data.holderName('builtin', id)}` : null;
  };

  const platformAdmin = roles.includes(PLATFORM_ADMIN_ROLE);
  const adminRule = platformAdmin ? [{ path: 'All data', access: 'export', through: 'platform admin', expiresAt: null }] : [];

  const rules = data.rules
    .map((r) => ({ r, through: via(r.holder_type, r.holder_id) }))
    .filter((x) => x.through && (!x.r.expires_at || x.r.expires_at.getTime() > now))
    .map(({ r, through }) => ({
      path: r.path,
      access: r.effect === 'block' ? 'block' : r.allow_export ? 'export' : 'use',
      through,
      expiresAt: r.expires_at?.toISOString() ?? null,
    }));

  const person = { userId, roles };
  const protections = [...model.protections.values()].map((p) => {
    const level = protectionLevel(model, person, p.id, now);
    const throughs = model.protectionGrants
      .filter((g) => g.protectionId === p.id && (!g.expiresAt || g.expiresAt.getTime() > now))
      .map((g) => via(g.holder.kind, g.holder.id))
      .filter((x): x is string => !!x);
    return { id: p.id, name: p.name, level, through: [...new Set(platformAdmin ? ['platform admin', ...throughs] : throughs)] };
  });

  return {
    roles,
    groups: memberships.map((m) => ({ id: m.groupId, name: groupName.get(m.groupId)!, expiresAt: m.expiresAt?.toISOString() ?? null })),
    builtins: builtins.map((b) => ({ id: b.id, name: b.name })),
    platformAdmin,
    rules: [...adminRule, ...rules],
    protections,
  };
}
