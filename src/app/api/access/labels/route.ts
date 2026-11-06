import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessClassify, serializeLabel } from '@/lib/access/admin-api';
import { isRaise, requirePlatformAdminFor } from '@/lib/access/sensitive';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireAccessClassify(req);
  const orgId = await getOrgId();
  const rows = await prisma.accessLabel.findMany({
    where: { org_id: orgId },
    orderBy: { path: 'asc' },
  });
  return ok({ labels: rows.map(serializeLabel) });
});

const UpsertLabel = z.object({
  path: z.string().min(1),
  label: z.enum(['confidential', 'restricted']),
  reason: z.string().min(1),
});

export const POST = handle(async (req) => {
  const auth = await requireAccessClassify(req);
  const orgId = await getOrgId();
  const body = parse(UpsertLabel, await req.json());
  const { path, pathDepth } = normalizeCatalogPath(body.path);

  const existingLabel = await prisma.accessLabel.findUnique({
    where: { org_id_path: { org_id: orgId, path } },
    select: { label: true },
  });
  if (existingLabel && isRaise(body.label, existingLabel.label as 'confidential' | 'restricted')) {
    requirePlatformAdminFor(auth, `lower a ${existingLabel.label} label`);
  }

  const label = await prisma.$transaction(async (tx) => {
    const row = await tx.accessLabel.upsert({
      where: { org_id_path: { org_id: orgId, path } },
      create: {
        org_id: orgId,
        path,
        path_depth: pathDepth,
        label: body.label,
        reason: body.reason,
        set_by: auth.userId,
      },
      update: {
        path_depth: pathDepth,
        label: body.label,
        reason: body.reason,
        set_by: auth.userId,
      },
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.label.set',
    entityType: 'access_label',
    entityId: label.id,
    after: { path: label.path, label: label.label, reason: label.reason },
    ...clientMeta(req),
  });

  return created({ label: serializeLabel(label) });
});

const DeleteLabel = z.object({ path: z.string().min(1), reason: z.string().max(500).optional().nullable() });

export const DELETE = handle(async (req) => {
  const auth = await requireAccessClassify(req);
  const orgId = await getOrgId();
  const body = parse(DeleteLabel, await req.json());
  const { path } = normalizeCatalogPath(body.path);

  const existing = await prisma.accessLabel.findUnique({
    where: { org_id_path: { org_id: orgId, path } },
  });
  if (!existing) throw new ApiError(404, 'Label not found');
  requirePlatformAdminFor(auth, `remove a ${existing.label} label`);

  await prisma.$transaction(async (tx) => {
    await tx.accessLabel.delete({ where: { org_id_path: { org_id: orgId, path } } });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.label.removed',
    entityType: 'access_label',
    entityId: existing.id,
    before: { path: existing.path, label: existing.label },
    metadata: body.reason ? { reason: body.reason } : undefined,
    ...clientMeta(req),
  });

  return noContent();
});
