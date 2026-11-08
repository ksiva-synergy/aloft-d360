import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { normalizeTagKey, ReasonSchema, serializeTag } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

/** Data tags (Compensation, Medical, …) with how many columns and grants each has. */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get('archived') === '1';

  const [tags, columnCounts, grantCounts] = await Promise.all([
    prisma.accessTag.findMany({
      where: { org_id: orgId, ...(includeArchived ? {} : { archived_at: null }) },
      orderBy: { name: 'asc' },
    }),
    prisma.accessColumnTag.groupBy({
      by: ['tag_id'],
      where: { org_id: orgId, status: 'confirmed' },
      _count: { _all: true },
    }),
    prisma.accessTagGrant.groupBy({ by: ['tag_id'], where: { org_id: orgId }, _count: { _all: true } }),
  ]);

  const cols = new Map(columnCounts.map((c) => [c.tag_id, c._count._all]));
  const grants = new Map(grantCounts.map((g) => [g.tag_id, g._count._all]));
  return ok({
    tags: tags.map((t) => serializeTag(t, { columns: cols.get(t.id) ?? 0, grants: grants.get(t.id) ?? 0 })),
  });
});

const CreateTag = z.object({
  key: z.string().min(2).max(64),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  requiresTwoApprovals: z.boolean().optional(),
  maxDurationDays: z.number().int().positive().max(3650).optional().nullable(),
  reason: ReasonSchema,
});

/** Creating a tag opens nothing: it only protects the columns that are later tagged with it. */
export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(CreateTag, await req.json());
  const key = normalizeTagKey(body.key);

  const existing = await prisma.accessTag.findUnique({ where: { org_id_key: { org_id: orgId, key } } });
  if (existing) throw new ApiError(409, `A tag with key "${key}" already exists`);

  const tag = await prisma.$transaction(async (tx) => {
    const row = await tx.accessTag.create({
      data: {
        org_id: orgId,
        key,
        name: body.name,
        description: body.description ?? null,
        requires_two_approvals: body.requiresTwoApprovals ?? false,
        max_duration_days: body.maxDurationDays ?? null,
        created_by: auth.userId,
      },
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.tag.created',
    entityType: 'access_tag',
    entityId: tag.id,
    after: { key: tag.key, name: tag.name, requiresTwoApprovals: tag.requires_two_approvals },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return created({ tag: serializeTag(tag, { columns: 0, grants: 0 }) });
});
