import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { evictAccessModel } from '@/lib/access/model-store';
import { requireAccessAdmin, requireAccessClassify } from '@/lib/access/admin-api';
import { requirePlatformAdminFor } from '@/lib/access/sensitive';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { assertActiveTag, ReasonSchema } from '@/lib/access/column-admin';

export const dynamic = 'force-dynamic';

/** Every whole-path protection: { tagId, path }. */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const rows = await prisma.accessPathProtection.findMany({
    where: { org_id: orgId },
    select: { id: true, tag_id: true, path: true, reason: true, created_at: true },
    orderBy: { path: 'asc' },
  });
  return ok({ pathProtections: rows.map((r) => ({ id: r.id, tagId: r.tag_id, path: r.path, reason: r.reason, createdAt: r.created_at.toISOString() })) });
});

const Body = z.object({ tagId: z.string().min(1), path: z.string().min(1), reason: ReasonSchema });

/** Protect a whole catalog, schema or table. Only narrows access, so Manage on Data access is enough. */
export const POST = handle(async (req) => {
  const auth = await requireAccessClassify(req);
  const orgId = await getOrgId();
  const body = parse(Body, await req.json());
  const { path, pathDepth } = normalizeCatalogPath(body.path);
  const tag = await assertActiveTag(orgId, body.tagId);

  await prisma.$transaction(async (tx) => {
    await tx.accessPathProtection.upsert({
      where: { org_id_tag_id_path: { org_id: orgId, tag_id: tag.id, path } },
      create: { org_id: orgId, tag_id: tag.id, path, path_depth: pathDepth, reason: body.reason, set_by: auth.userId },
      update: {},
    });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);
  evictAccessModel(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.path_protection.set',
    entityType: 'access_tag',
    entityId: tag.id,
    after: { path, protection: tag.name },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return created({ ok: true, path, tagId: tag.id });
});

/** Stop protecting a path. This opens data, so platform admin only. */
export const DELETE = handle(async (req) => {
  const auth = await requireAccessClassify(req);
  requirePlatformAdminFor(auth, 'remove a protection from a catalog, schema or table');
  const orgId = await getOrgId();
  const body = parse(Body, await req.json());
  const { path } = normalizeCatalogPath(body.path);

  await prisma.$transaction(async (tx) => {
    const removed = await tx.accessPathProtection.deleteMany({ where: { org_id: orgId, tag_id: body.tagId, path } });
    if (removed.count === 0) throw new ApiError(404, 'That path does not have this protection');
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);
  evictAccessModel(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.path_protection.removed',
    entityType: 'access_tag',
    entityId: body.tagId,
    before: { path },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });
  return noContent();
});
