import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, noContent, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { assertNotSelfClearance } from '@/lib/access/guards';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { requireAccessAdmin, serializeClearance } from '@/lib/access/admin-api';
import { isRaise, requirePlatformAdminFor } from '@/lib/access/sensitive';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const rows = await prisma.accessClearance.findMany({
    where: { org_id: orgId },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { updated_at: 'desc' },
  });
  return ok({ clearances: rows.map(serializeClearance) });
});

const UpsertClearance = z.object({
  userId: z.string().min(1),
  level: z.enum(['confidential', 'restricted']),
  reason: z.string().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const POST = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(UpsertClearance, await req.json());
  assertNotSelfClearance(auth.userId, body.userId);

  const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, email: true } });
  if (!user) throw new ApiError(404, 'User not found');

  const current = await prisma.accessClearance.findUnique({
    where: { org_id_user_id: { org_id: orgId, user_id: body.userId } },
    select: { level: true },
  });
  const from = current?.level === 'confidential' || current?.level === 'restricted' ? current.level : 'internal';
  if (isRaise(from, body.level)) requirePlatformAdminFor(auth, `give ${body.level} clearance`);

  const clearance = await prisma.$transaction(async (tx) => {
    const row = await tx.accessClearance.upsert({
      where: { org_id_user_id: { org_id: orgId, user_id: body.userId } },
      create: {
        org_id: orgId,
        user_id: body.userId,
        level: body.level,
        reason: body.reason ?? null,
        granted_by: auth.userId,
        expires_at: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      update: {
        level: body.level,
        reason: body.reason ?? null,
        granted_by: auth.userId,
        expires_at: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      include: { user: { select: { email: true, name: true } } },
    });
    await bumpPolicyVersionInTx(tx, orgId);
    return row;
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.clearance.set',
    entityType: 'access_clearance',
    entityId: body.userId,
    after: { userId: body.userId, level: body.level },
    ...clientMeta(req),
  });

  return created({ clearance: serializeClearance(clearance) });
});

const DeleteClearance = z.object({ userId: z.string().min(1) });

export const DELETE = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(DeleteClearance, await req.json());
  assertNotSelfClearance(auth.userId, body.userId);

  const existing = await prisma.accessClearance.findUnique({
    where: { org_id_user_id: { org_id: orgId, user_id: body.userId } },
  });
  if (!existing) throw new ApiError(404, 'Clearance not found');

  await prisma.$transaction(async (tx) => {
    await tx.accessClearance.delete({ where: { org_id_user_id: { org_id: orgId, user_id: body.userId } } });
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.clearance.removed',
    entityType: 'access_clearance',
    entityId: body.userId,
    before: { level: existing.level },
    ...clientMeta(req),
  });

  return noContent();
});
