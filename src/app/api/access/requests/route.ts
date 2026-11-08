import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, created, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { resolveAuth } from '@/middleware/auth';
import { levelsForContext } from '@/lib/sections/server';
import { isPlatformAdminRole } from '@/lib/access/sensitive';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { assertCanRequest, autoApprovable, evictAfterGrant, grantApproved, OPEN_STATUSES, requestNumber, routeRequest, writeEvent } from '@/lib/access/requests';
import { notify } from '@/lib/access/notifications';

export const dynamic = 'force-dynamic';

/**
 * Access requests. Every signed-in person may ask and see their own requests; approvers see what is
 * routed to them; people with View on Data access (and platform admins) see the history.
 *
 *   GET ?view=mine                     my requests
 *   GET ?view=inbox                    open requests I can decide (platform admins: all open)
 *   GET ?view=history&days=30|60|90    everything updated in the window (never older than 90 days, D14)
 */
export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  const orgId = await getOrgId();
  const url = new URL(req.url);
  const view = url.searchParams.get('view') ?? 'mine';
  const isPa = isPlatformAdminRole(auth.role);

  let where: Record<string, unknown>;
  if (view === 'mine') {
    where = { org_id: orgId, requester_id: auth.userId };
  } else if (view === 'inbox') {
    where = { org_id: orgId, status: { in: OPEN_STATUSES }, ...(isPa ? {} : { routed_to: { has: auth.userId } }), NOT: { requester_id: auth.userId } };
  } else if (view === 'history') {
    if (!isPa && levelsForContext(auth)['govern.data-access'] === 'none') throw new ApiError(403, 'You do not have access to Data access.');
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 30) || 30));
    where = { org_id: orgId, updated_at: { gte: new Date(Date.now() - days * 86_400_000) } };
  } else {
    throw new ApiError(400, 'view must be mine, inbox or history');
  }

  const rows = await prisma.accessRequest.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
  const userIds = [...new Set(rows.flatMap((r) => [r.requester_id, r.decided_by, ...r.routed_to].filter((x): x is string => !!x)))];
  const tagIds = [...new Set(rows.map((r) => r.tag_id).filter((x): x is string => !!x))];
  const [users, tags] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
    tagIds.length
      ? prisma.accessTag.findMany({ where: { id: { in: tagIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));

  return ok({
    requests: rows.map((r) => ({
      id: r.id,
      number: requestNumber(r.seq),
      requesterId: r.requester_id,
      requester: name.get(r.requester_id) ?? r.requester_id,
      targetType: r.target_type,
      tagId: r.tag_id,
      target: r.target_type === 'tag' ? (tagName.get(r.tag_id ?? '') ?? 'Removed protection') : r.path,
      level: r.level,
      durationDays: r.duration_days,
      reason: r.reason,
      ticketRef: r.ticket_ref,
      status: r.status,
      approvers: r.routed_to.map((id) => name.get(id) ?? id),
      canDecide: r.requester_id !== auth.userId && OPEN_STATUSES.includes(r.status as never) && (isPa || r.routed_to.includes(auth.userId)),
      decidedBy: r.decided_by ? (name.get(r.decided_by) ?? r.decided_by) : null,
      decidedAt: r.decided_at?.toISOString() ?? null,
      grantedUntil: r.granted_until?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    })),
  });
});

const CreateRequest = z
  .object({
    targetType: z.enum(['tag', 'path']),
    tagId: z.string().optional().nullable(),
    path: z.string().optional().nullable(),
    level: z.enum(['aggregate', 'full', 'query', 'export']),
    /** 7, 30 or 90 days; null = no end date (not allowed for two-approval protections). */
    durationDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable().optional(),
    reason: z.string().trim().min(20, 'Explain why you need it (at least 20 characters)').max(1000),
    ticketRef: z.string().trim().max(100).optional().nullable(),
  })
  .refine((b) => (b.targetType === 'tag' ? !!b.tagId && (b.level === 'aggregate' || b.level === 'full') : !!b.path && (b.level === 'query' || b.level === 'export')), {
    message: 'Ask for a protection at Totals only / Exact values, or for a path to Use / Use + export',
  });

/** Ask for access. Routed automatically; the requester never picks the approver. */
export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  const orgId = await getOrgId();
  const body = parse(CreateRequest, await req.json());
  const durationDays = body.durationDays === undefined ? 30 : body.durationDays;

  let target: { targetType: 'tag' | 'path'; tagId?: string | null; path?: string | null };
  if (body.targetType === 'tag') {
    const tag = await prisma.accessTag.findFirst({ where: { id: body.tagId!, org_id: orgId, archived_at: null } });
    if (!tag) throw new ApiError(404, 'That protection does not exist');
    if (tag.requires_two_approvals && durationDays === null) throw new ApiError(400, 'This data can only be requested for a limited time (7, 30 or 90 days).');
    target = { targetType: 'tag', tagId: tag.id };
  } else {
    target = { targetType: 'path', path: normalizeCatalogPath(body.path!).path };
  }

  await assertCanRequest(orgId, auth.userId, target);
  const route = await routeRequest(orgId, auth.userId, target);
  const auto = target.targetType === 'path' && (await autoApprovable(orgId, target.path!, body.level));
  if (route.approvers.length === 0 && !auto) throw new ApiError(409, 'Nobody can approve this yet. Ask a platform admin.');
  const meta = clientMeta(req);

  const request = await prisma.$transaction(async (tx) => {
    const r = await tx.accessRequest.create({
      data: {
        org_id: orgId,
        requester_id: auth.userId,
        target_type: target.targetType,
        tag_id: target.tagId ?? null,
        path: target.path ?? null,
        level: body.level,
        duration_days: durationDays,
        reason: body.reason,
        ticket_ref: body.ticketRef ?? null,
        routed_to: route.approvers,
      },
    });
    await writeEvent(tx, { orgId, requestId: r.id, type: 'requested', actorId: auth.userId, after: { ...target, level: body.level, durationDays }, comment: body.reason, ...meta });
    await writeEvent(tx, { orgId, requestId: r.id, type: 'routed', actorId: null, after: { approvers: route.approvers, twoApprovals: route.twoApprovals, needsPlatformAdmin: route.needsPlatformAdmin } });
    if (auto) {
      // A rule covering this unprotected data approves requests automatically.
      const until = await grantApproved(tx, orgId, r, body.level, durationDays, auth.userId, requestNumber(r.seq));
      await tx.accessRequest.update({ where: { id: r.id }, data: { status: 'approved', decided_at: new Date(), granted_until: until } });
      await writeEvent(tx, { orgId, requestId: r.id, type: 'approved', actorId: null, after: { status: 'approved', auto: true }, comment: 'Approved automatically by an access rule' });
      await writeEvent(tx, { orgId, requestId: r.id, type: 'granted', actorId: null, after: { until: until?.toISOString() ?? null } });
    } else {
      await notify(tx, {
        orgId,
        userIds: route.approvers,
        kind: 'routed',
        requestId: r.id,
        title: `${requestNumber(r.seq)}: access request to decide`,
        body: body.reason,
        link: '/agent-staging/data-access?tab=log',
      });
    }
    return r;
  });
  if (auto) evictAfterGrant(orgId);

  await writeAudit({
    actorId: auth.userId,
    action: 'access.request.created',
    entityType: 'access_request',
    entityId: request.id,
    after: { number: requestNumber(request.seq), ...target, level: body.level, durationDays },
    metadata: { reason: body.reason },
    ...meta,
  });

  return created({ request: { id: request.id, number: requestNumber(request.seq), status: auto ? 'approved' : request.status, autoApproved: auto, approvers: route.approvers.length } });
});
