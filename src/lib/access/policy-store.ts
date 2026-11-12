import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withPrismaReadRetry } from '@/lib/db/with-prisma-read-retry';
import type {
  ColumnPolicy,
  GrantRow,
  LabelRow,
  PolicySnapshot,
  SensitivityLabel,
  TagGrantRow,
} from './types';

type Tx = Prisma.TransactionClient;

type CacheEntry = { version: bigint; snapshot: PolicySnapshot; loadedAt: number };

const _g = globalThis as typeof globalThis & {
  _accessPolicyCache?: Map<string, CacheEntry>;
};
if (!_g._accessPolicyCache) _g._accessPolicyCache = new Map();
const cache = _g._accessPolicyCache;

const CACHE_TTL_MS = 60_000;

function isMissingTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2021';
}

/** Stale or pre-migration Prisma client (column-access models not generated yet). */
function columnAccessPrismaReady(): boolean {
  const p = prisma as {
    accessTag?: { findMany?: unknown };
    accessColumnTag?: { findMany?: unknown };
    accessTagGrant?: { findMany?: unknown };
    accessGroup?: { findMany?: unknown };
    accessGroupMember?: { findMany?: unknown };
  };
  return !!(
    p.accessTag?.findMany &&
    p.accessColumnTag?.findMany &&
    p.accessTagGrant?.findMany &&
    p.accessGroup?.findMany &&
    p.accessGroupMember?.findMany
  );
}

/** Current policy version (bumped on every access change). */
export async function readPolicyVersion(orgId: string): Promise<bigint> {
  return readVersion(orgId);
}

async function readVersion(orgId: string): Promise<bigint> {
  try {
    const row = await prisma.accessPolicyVersion.findUnique({ where: { org_id: orgId } });
    return row?.version ?? BigInt(0);
  } catch (err) {
    if (isMissingTable(err)) return BigInt(0);
    throw err;
  }
}

async function loadSnapshotFromDb(orgId: string, version: bigint): Promise<PolicySnapshot> {
  let grants: GrantRow[] = [];
  let labels: LabelRow[] = [];
  const clearances = new Map<string, SensitivityLabel>();
  const membersByUser = new Map<string, string[]>();

  try {
    const [grantRows, labelRows, clearanceRows, memberRows] = await Promise.all([
      prisma.accessGrant.findMany({ where: { org_id: orgId } }),
      prisma.accessLabel.findMany({ where: { org_id: orgId } }),
      prisma.accessClearance.findMany({ where: { org_id: orgId } }),
      prisma.accessDepartmentMember.findMany({
        where: { department: { org_id: orgId } },
        select: { user_id: true, department_id: true },
      }),
    ]);

    grants = grantRows.map((g) => ({
      principalType: g.principal_type as GrantRow['principalType'],
      principalId: g.principal_id,
      path: g.path.toLowerCase(),
      pathDepth: g.path_depth as GrantRow['pathDepth'],
      level: g.level as GrantRow['level'],
      effect: g.effect as GrantRow['effect'],
      expiresAt: g.expires_at,
    }));

    labels = labelRows.map((l) => ({
      path: l.path.toLowerCase(),
      pathDepth: l.path_depth as LabelRow['pathDepth'],
      label: l.label as LabelRow['label'],
    }));

    for (const c of clearanceRows) {
      if (c.level === 'confidential' || c.level === 'restricted') {
        clearances.set(c.user_id, c.level);
      }
    }

    for (const m of memberRows) {
      const list = membersByUser.get(m.user_id) ?? [];
      list.push(m.department_id);
      membersByUser.set(m.user_id, list);
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  return {
    orgId,
    version,
    grants,
    labels,
    clearances,
    membersByUser,
    legacyOpen: grants.length === 0,
    columns: await loadColumnPolicy(orgId),
  };
}

export function emptyColumnPolicy(): ColumnPolicy {
  return { tags: new Map(), columnTags: new Map(), tagGrants: [], groupsByUser: new Map() };
}

/**
 * Confirmed column tags, tag grants and access group memberships. Loaded separately so a
 * database without the 20261107 migration still gets a valid (empty) column policy.
 */
async function loadColumnPolicy(orgId: string): Promise<ColumnPolicy> {
  if (!columnAccessPrismaReady()) return emptyColumnPolicy();
  const policy = emptyColumnPolicy();
  try {
    const [tagRows, columnTagRows, grantRows, groupRows] = await Promise.all([
      prisma.accessTag.findMany({ where: { org_id: orgId, archived_at: null } }),
      prisma.accessColumnTag.findMany({
        where: { org_id: orgId, status: 'confirmed' },
        select: { table_path: true, column_name: true, tag_id: true },
      }),
      prisma.accessTagGrant.findMany({ where: { org_id: orgId } }),
      prisma.accessGroup.findMany({ where: { org_id: orgId, archived_at: null }, select: { id: true } }),
    ]);

    for (const t of tagRows) {
      policy.tags.set(t.id, {
        id: t.id,
        key: t.key,
        name: t.name,
        requiresTwoApprovals: t.requires_two_approvals,
      });
    }

    for (const c of columnTagRows) {
      if (!policy.tags.has(c.tag_id)) continue; // archived tag: not enforced
      const table = c.table_path.toLowerCase();
      const column = c.column_name.toLowerCase();
      const byColumn = policy.columnTags.get(table) ?? new Map<string, string[]>();
      const ids = byColumn.get(column) ?? [];
      if (!ids.includes(c.tag_id)) ids.push(c.tag_id);
      byColumn.set(column, ids);
      policy.columnTags.set(table, byColumn);
    }

    const activeGroups = new Set(groupRows.map((g) => g.id));

    for (const g of grantRows) {
      if (!policy.tags.has(g.tag_id)) continue;
      if (g.principal_type === 'group' && !activeGroups.has(g.principal_id)) continue;
      policy.tagGrants.push({
        tagId: g.tag_id,
        principalType: g.principal_type as TagGrantRow['principalType'],
        principalId: g.principal_id,
        level: g.level as TagGrantRow['level'],
        expiresAt: g.expires_at,
      });
    }

    if (activeGroups.size > 0) {
      const memberRows = await prisma.accessGroupMember.findMany({
        where: { group_id: { in: [...activeGroups] } },
        select: { group_id: true, user_id: true, expires_at: true },
      });
      for (const m of memberRows) {
        const list = policy.groupsByUser.get(m.user_id) ?? [];
        list.push({ groupId: m.group_id, expiresAt: m.expires_at });
        policy.groupsByUser.set(m.user_id, list);
      }
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return emptyColumnPolicy();
  }
  return policy;
}

export async function loadPolicySnapshot(orgId: string): Promise<PolicySnapshot> {
  return withPrismaReadRetry(
    async () => {
      const version = await readVersion(orgId);
      const cached = cache.get(orgId);
      const fresh = cached && cached.version === version && Date.now() - cached.loadedAt < CACHE_TTL_MS;
      if (fresh) return cached!.snapshot;

      const snapshot = await loadSnapshotFromDb(orgId, version);
      cache.set(orgId, { version, snapshot, loadedAt: Date.now() });
      return snapshot;
    },
    { maxAttempts: 3, backoffMs: 500 },
  );
}

export function evictPolicySnapshot(orgId: string): void {
  cache.delete(orgId);
}

/** @deprecated use evictPolicySnapshot */
export function invalidatePolicyCache(orgId?: string): void {
  if (orgId) evictPolicySnapshot(orgId);
  else cache.clear();
}

export function clearanceForUser(policy: PolicySnapshot, userId: string): SensitivityLabel {
  return policy.clearances.get(userId) ?? 'internal';
}

export function departmentsForUser(policy: PolicySnapshot, userId: string): string[] {
  return policy.membersByUser.get(userId) ?? [];
}

export async function bumpPolicyVersionInTx(tx: Tx, orgId: string): Promise<bigint> {
  const row = await tx.accessPolicyVersion.upsert({
    where: { org_id: orgId },
    create: { org_id: orgId, version: BigInt(1) },
    update: { version: { increment: 1 } },
  });
  return row.version;
}

export async function bumpPolicyVersion(orgId: string): Promise<bigint> {
  const version = await withPrismaReadRetry(
    () => prisma.$transaction((tx) => bumpPolicyVersionInTx(tx, orgId)),
    { maxAttempts: 3, backoffMs: 500 },
  );
  evictPolicySnapshot(orgId);
  return version;
}
