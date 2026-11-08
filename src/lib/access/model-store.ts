/**
 * Load the simplified access model (engine.ts) from its own tables:
 *   access_rules            → rules
 *   access_tags             → protections (active only)
 *   access_path_protections → whole-path targets
 *   access_column_tags      → column targets (confirmed only)
 *   access_tag_grants       → protection grants
 *   access_group_members    → memberships (active groups only)
 *
 * `buildAccessModel` is pure so it can be tested; `loadAccessModel` reads the database.
 * `getAccessModel` caches per org and policy version (60 s), like the old policy snapshot.
 */
import { prisma } from '@/lib/db';
import { withPrismaReadRetry } from '@/lib/db/with-prisma-read-retry';
import { readPolicyVersion } from './policy-store';
import type { AccessModel, AccessRule, Holder, Membership, Protection, ProtectedTarget, ProtectionGrant } from './engine';
import type { TagGrantLevel } from './types';

export interface AccessModelRows {
  rules: { holder_type: string; holder_id: string; path: string; effect: string; allow_export: boolean; expires_at: Date | null }[];
  tags: { id: string; name: string; key?: string; archived_at: Date | null }[];
  pathProtections: { tag_id: string; path: string }[];
  columnTags: { tag_id: string; table_path: string; column_name: string; status: string }[];
  tagGrants: { tag_id: string; principal_type: string; principal_id: string; level: string; expires_at: Date | null }[];
  groups: { id: string; archived_at: Date | null }[];
  members: { group_id: string; user_id: string; expires_at: Date | null }[];
}

export function buildAccessModel(rows: AccessModelRows): AccessModel {
  const protections = new Map<string, Protection>();
  for (const t of rows.tags) if (!t.archived_at) protections.set(t.id, { id: t.id, name: t.name, key: t.key });

  const activeGroups = new Set(rows.groups.filter((g) => !g.archived_at).map((g) => g.id));

  const rules: AccessRule[] = [];
  for (const r of rows.rules) {
    if (r.holder_type === 'group' && !activeGroups.has(r.holder_id)) continue;
    rules.push({
      holder: { kind: r.holder_type as Holder['kind'], id: r.holder_id } as Holder,
      path: r.path.toLowerCase(),
      effect: r.effect === 'block' ? 'block' : 'use',
      allowExport: r.allow_export,
      expiresAt: r.expires_at,
    });
  }

  const targets: ProtectedTarget[] = [];
  for (const p of rows.pathProtections) {
    if (protections.has(p.tag_id)) targets.push({ protectionId: p.tag_id, path: p.path.toLowerCase(), column: null });
  }
  for (const c of rows.columnTags) {
    if (c.status === 'confirmed' && protections.has(c.tag_id)) {
      targets.push({ protectionId: c.tag_id, path: c.table_path.toLowerCase(), column: c.column_name.toLowerCase() });
    }
  }

  const protectionGrants: ProtectionGrant[] = [];
  for (const g of rows.tagGrants) {
    if (!protections.has(g.tag_id)) continue;
    if (g.principal_type === 'group' && !activeGroups.has(g.principal_id)) continue;
    protectionGrants.push({
      protectionId: g.tag_id,
      holder: g.principal_type === 'group' ? { kind: 'group', id: g.principal_id } : { kind: 'person', id: g.principal_id },
      level: g.level as TagGrantLevel,
      expiresAt: g.expires_at,
    });
  }

  const membersByUser = new Map<string, Membership[]>();
  for (const m of rows.members) {
    if (!activeGroups.has(m.group_id)) continue;
    const list = membersByUser.get(m.user_id) ?? [];
    list.push({ groupId: m.group_id, expiresAt: m.expires_at });
    membersByUser.set(m.user_id, list);
  }

  return { rules, protections, targets, protectionGrants, membersByUser, bootstrapOpen: rules.length === 0 };
}

export async function loadAccessModel(orgId: string): Promise<AccessModel> {
  const [rules, tags, pathProtections, columnTags, tagGrants, groups] = await Promise.all([
    prisma.accessRule.findMany({ where: { org_id: orgId } }),
    prisma.accessTag.findMany({ where: { org_id: orgId }, select: { id: true, name: true, key: true, archived_at: true } }),
    prisma.accessPathProtection.findMany({ where: { org_id: orgId }, select: { tag_id: true, path: true } }),
    prisma.accessColumnTag.findMany({
      where: { org_id: orgId },
      select: { tag_id: true, table_path: true, column_name: true, status: true },
    }),
    prisma.accessTagGrant.findMany({ where: { org_id: orgId } }),
    prisma.accessGroup.findMany({ where: { org_id: orgId }, select: { id: true, archived_at: true } }),
  ]);
  const members = groups.length
    ? await prisma.accessGroupMember.findMany({
        where: { group_id: { in: groups.map((g) => g.id) } },
        select: { group_id: true, user_id: true, expires_at: true },
      })
    : [];
  return buildAccessModel({ rules, tags, pathProtections, columnTags, tagGrants, groups, members });
}

type CacheEntry = { version: bigint; model: AccessModel; loadedAt: number };
const _g = globalThis as typeof globalThis & { _accessModelCache?: Map<string, CacheEntry> };
if (!_g._accessModelCache) _g._accessModelCache = new Map();
const cache = _g._accessModelCache;
const TTL_MS = 60_000;

function isMissingTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2021';
}

const EMPTY: AccessModel = {
  rules: [],
  protections: new Map(),
  targets: [],
  protectionGrants: [],
  membersByUser: new Map(),
  bootstrapOpen: true,
};

/** The model for request-time checks; reloads when the policy version changes or after 60 s. */
export async function getAccessModel(orgId: string): Promise<{ model: AccessModel; version: bigint }> {
  return withPrismaReadRetry(
    async () => {
      const version = await readPolicyVersion(orgId);
      const hit = cache.get(orgId);
      if (hit && hit.version === version && Date.now() - hit.loadedAt < TTL_MS) return { model: hit.model, version };
      let model: AccessModel;
      try {
        model = await loadAccessModel(orgId);
      } catch (err) {
        if (!isMissingTable(err)) throw err;
        model = EMPTY; // migration 20261108 not applied in this environment
      }
      cache.set(orgId, { version, model, loadedAt: Date.now() });
      return { model, version };
    },
    { maxAttempts: 3, backoffMs: 500 },
  );
}

export function evictAccessModel(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}
