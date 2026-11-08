import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { normalizeTagKey, peopleById, ReasonSchema, serializeTagGrant } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

/** Access groups with owners, members (and their end dates) and tag grants. */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get('archived') === '1';

  const groups = await prisma.accessGroup.findMany({
    where: { org_id: orgId, ...(includeArchived ? {} : { archived_at: null }) },
    orderBy: { name: 'asc' },
  });
  const ids = groups.map((g) => g.id);
  const [owners, members, grants] = ids.length
    ? await Promise.all([
        prisma.accessGroupOwner.findMany({ where: { group_id: { in: ids } } }),
        prisma.accessGroupMember.findMany({ where: { group_id: { in: ids } }, orderBy: { added_at: 'asc' } }),
        prisma.accessTagGrant.findMany({ where: { org_id: orgId, principal_type: 'group', principal_id: { in: ids } } }),
      ])
    : [[], [], []];

  const people = await peopleById([...owners.map((o) => o.user_id), ...members.map((m) => m.user_id)]);
  const person = (id: string) => {
    const p = people.get(id);
    return { userId: id, email: p?.email ?? null, name: p?.name ?? null };
  };
  const now = Date.now();

  return ok({
    groups: groups.map((g) => ({
      id: g.id,
      key: g.key,
      name: g.name,
      description: g.description,
      archivedAt: g.archived_at?.toISOString() ?? null,
      createdAt: g.created_at.toISOString(),
      owners: owners.filter((o) => o.group_id === g.id).map((o) => person(o.user_id)),
      members: members
        .filter((m) => m.group_id === g.id)
        .map((m) => ({
          ...person(m.user_id),
          expiresAt: m.expires_at?.toISOString() ?? null,
          expired: !!m.expires_at && m.expires_at.getTime() <= now,
          reason: m.reason,
          grantedBy: m.granted_by,
          addedAt: m.added_at.toISOString(),
        })),
      grants: grants.filter((x) => x.principal_id === g.id).map(serializeTagGrant),
    })),
  });
});

const CreateGroup = z.object({
  key: z.string().min(2).max(64),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  /** At least one owner. Owners approve who joins. */
  ownerIds: z.array(z.string().min(1)).min(1, 'A group needs at least one owner').max(20),
  reason: ReasonSchema,
});

/** A new group has owners but no members and no grants, so it opens nothing yet. */
export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(CreateGroup, await req.json());
  const key = normalizeTagKey(body.key);
  const ownerIds = [...new Set(body.ownerIds)];

  const existing = await prisma.accessGroup.findUnique({ where: { org_id_key: { org_id: orgId, key } } });
  if (existing) throw new ApiError(409, `A group with key "${key}" already exists`);

  const found = await peopleById(ownerIds);
  const missing = ownerIds.filter((id) => !found.has(id));
  if (missing.length) throw new ApiError(404, 'One or more owners were not found');

  const group = await prisma.$transaction(async (tx) => {
    const row = await tx.accessGroup.create({
      data: {
        org_id: orgId,
        key,
        name: body.name,
        description: body.description ?? null,
        created_by: auth.userId,
      },
    });
    await tx.accessGroupOwner.createMany({
      data: ownerIds.map((user_id) => ({ group_id: row.id, user_id, added_by: auth.userId })),
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.group.created',
    entityType: 'access_group',
    entityId: group.id,
    after: { key: group.key, name: group.name, owners: ownerIds.map((id) => found.get(id)?.email ?? id) },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return created({ group: { id: group.id, key: group.key, name: group.name } });
});
