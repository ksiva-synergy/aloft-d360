import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { bumpPolicyVersionInTx, evictPolicySnapshot } from '@/lib/access/policy-store';
import { evictAccessModel } from '@/lib/access/model-store';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { assertActiveGroup, parseExpiry, ReasonSchema } from '@/lib/access/column-admin';
import { BUILTIN_GROUPS } from '@/lib/access/engine';
import { loadAccessAdminData } from '@/lib/access/rules-admin';

export const dynamic = 'force-dynamic';

/** Rules for one holder (?holderType=&holderId=) or one exact path (?path=). */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const holderType = url.searchParams.get('holderType');
  const holderId = url.searchParams.get('holderId');
  const path = url.searchParams.get('path');
  const data = await loadAccessAdminData(orgId);
  const rows = data.rules.filter(
    (r) => (!holderType || r.holder_type === holderType) && (!holderId || r.holder_id === holderId) && (!path || r.path === path.toLowerCase()),
  );
  return ok({
    rules: rows.map((r) => ({
      id: r.id,
      holderType: r.holder_type,
      holderId: r.holder_id,
      holderName: data.holderName(r.holder_type, r.holder_id),
      path: r.path,
      access: r.effect === 'block' ? 'block' : r.allow_export ? 'export' : 'use',
      autoApprove: r.auto_approve,
      expiresAt: r.expires_at?.toISOString() ?? null,
    })),
  });
});

const SetRule = z.object({
  holderType: z.enum(['person', 'group', 'builtin']),
  holderId: z.string().min(1),
  path: z.string().min(1),
  /** none removes the holder's rules on this exact path. */
  access: z.enum(['none', 'use', 'export', 'block']),
  /** Approve requests for data this rule covers automatically (unprotected data only). */
  autoApprove: z.boolean().optional(),
  expiresAt: z.string().optional().nullable(),
  reason: ReasonSchema,
});

/**
 * Set one holder's access on one path. Protected data stays protected whatever is set here, so this
 * needs Manage on Data access, not platform admin. Nobody sets access for themselves.
 */
export const PUT = handle(async (req) => {
  const auth = await requireAccessAdmin(req);
  const orgId = await getOrgId();
  const body = parse(SetRule, await req.json());
  const { path, pathDepth } = normalizeCatalogPath(body.path);
  const expiresAt = parseExpiry(body.expiresAt);

  if (body.holderType === 'person') {
    if (body.holderId === auth.userId) throw new ApiError(403, 'You cannot set your own data access. Ask another admin.');
    const user = await prisma.user.findUnique({ where: { id: body.holderId }, select: { id: true } });
    if (!user) throw new ApiError(404, 'User not found');
  } else if (body.holderType === 'group') {
    await assertActiveGroup(orgId, body.holderId);
  } else if (!BUILTIN_GROUPS.some((b) => b.id === body.holderId)) {
    const role = await prisma.role.findUnique({ where: { name: body.holderId }, select: { name: true } });
    if (!role) throw new ApiError(404, 'Unknown built-in group');
  }

  const where = { org_id: orgId, holder_type: body.holderType, holder_id: body.holderId, path };
  const before = await prisma.accessRule.findMany({ where });

  await prisma.$transaction(async (tx) => {
    await tx.accessRule.deleteMany({ where });
    if (body.access !== 'none') {
      await tx.accessRule.create({
        data: {
          ...where,
          path_depth: pathDepth,
          effect: body.access === 'block' ? 'block' : 'use',
          allow_export: body.access === 'export',
          auto_approve: body.access !== 'block' && !!body.autoApprove,
          expires_at: expiresAt,
          reason: body.reason,
          created_by: auth.userId,
        },
      });
    }
    await bumpPolicyVersionInTx(tx, orgId);
  });
  evictPolicySnapshot(orgId);
  evictAccessModel(orgId);

  const data = await loadAccessAdminData(orgId);
  await writeAudit({
    actorId: auth.userId,
    action: 'access.rule.set',
    entityType: 'access_rule',
    entityId: path,
    before: before.map((r) => ({ effect: r.effect, allowExport: r.allow_export, expiresAt: r.expires_at?.toISOString() ?? null })),
    after: { holder: `${body.holderType}:${data.holderName(body.holderType, body.holderId)}`, path, access: body.access, expiresAt: expiresAt?.toISOString() ?? null },
    metadata: { reason: body.reason },
    ...clientMeta(req),
  });

  return ok({ ok: true, path, access: body.access });
});
