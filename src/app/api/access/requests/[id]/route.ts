import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handle, ok, parse, clientMeta, ApiError } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { getOrgId } from '@/lib/databricks/connections';
import { resolveAuth } from '@/middleware/auth';
import { levelsForContext } from '@/lib/sections/server';
import { isPlatformAdminRole } from '@/lib/access/sensitive';
import { evictAfterGrant, grantApproved, OPEN_STATUSES, platformAdminIds, requestNumber, writeEvent, type RequestLevel } from '@/lib/access/requests';
import { notify } from '@/lib/access/notifications';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function loadRequest(orgId: string, id: string) {
  const r = await prisma.accessRequest.findFirst({ where: { id, org_id: orgId } });
  if (!r) throw new ApiError(404, 'Request not found');
  return r;
}

/** One request with its full history. Requester, its approvers, platform admins, or View on Data access. */
export const GET = handle(async (req, ctx: Ctx) => {
  const auth = await resolveAuth(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const r = await loadRequest(orgId, id);
  const allowed =
    r.requester_id === auth.userId ||
    r.routed_to.includes(auth.userId) ||
    isPlatformAdminRole(auth.role) ||
    levelsForContext(auth)['govern.data-access'] !== 'none';
  if (!allowed) throw new ApiError(404, 'Request not found');

  const events = await prisma.accessRequestEvent.findMany({ where: { request_id: r.id }, orderBy: { ts: 'asc' } });
  const ids = [...new Set(events.map((e) => e.actor_id).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
  return ok({
    request: { id: r.id, number: requestNumber(r.seq), status: r.status },
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor_id ? (name.get(e.actor_id) ?? e.actor_id) : 'system',
      ts: e.ts.toISOString(),
      comment: e.comment,
      before: e.before,
      after: e.after,
    })),
  });
});

const LEVEL_RANK: Record<RequestLevel, number> = { aggregate: 1, full: 2, query: 1, export: 2 };

const Action = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    /** Narrower than asked only: full → aggregate, export → query. */
    level: z.enum(['aggregate', 'full', 'query', 'export']).optional(),
    /** Shorter than asked only. null keeps "no end date" only if that was asked. */
    durationDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable().optional(),
    comment: z.string().trim().max(1000).optional().nullable(),
  }),
  z.object({ action: z.literal('reject'), comment: z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000) }),
  z.object({ action: z.literal('ask_info'), comment: z.string().trim().min(5, 'Ask a question (at least 5 characters)').max(1000) }),
  z.object({ action: z.literal('info_given'), comment: z.string().trim().min(5).max(1000) }),
  z.object({ action: z.literal('cancel'), comment: z.string().trim().max(1000).optional().nullable() }),
]);

/**
 * Decide or follow up. Approvers (routed people, or any platform admin) approve / reject / ask for
 * information; the requester answers or cancels. Nobody decides their own request.
 * Two-approval protections need one approver who is not a platform admin and one platform admin.
 */
export const POST = handle(async (req, ctx: Ctx) => {
  const auth = await resolveAuth(req);
  const orgId = await getOrgId();
  const { id } = await ctx.params;
  const body = parse(Action, await req.json());
  const r = await loadRequest(orgId, id);
  const meta = clientMeta(req);
  const isPa = isPlatformAdminRole(auth.role);
  const isRequester = r.requester_id === auth.userId;
  const isApprover = !isRequester && (isPa || r.routed_to.includes(auth.userId));
  const open = OPEN_STATUSES.includes(r.status as never);

  if (body.action === 'info_given' || body.action === 'cancel') {
    if (!isRequester) throw new ApiError(403, 'Only the person who asked can do this.');
    if (!open) throw new ApiError(409, 'This request is already closed.');
    if (body.action === 'info_given' && r.status !== 'info_requested') throw new ApiError(409, 'Nobody asked for more information.');
    const status = body.action === 'cancel' ? 'cancelled' : 'pending';
    await prisma.$transaction(async (tx) => {
      await tx.accessRequest.update({ where: { id: r.id }, data: { status } });
      await writeEvent(tx, { orgId, requestId: r.id, type: body.action === 'cancel' ? 'cancelled' : 'info_given', actorId: auth.userId, before: { status: r.status }, after: { status }, comment: body.comment ?? null, ...meta });
      if (body.action === 'info_given') {
        await notify(tx, { orgId, userIds: r.routed_to, kind: `info_given:${Date.now()}`, requestId: r.id, title: `${requestNumber(r.seq)}: the requester answered`, body: body.comment, link: '/agent-staging/data-access?tab=log' });
      }
    });
    return ok({ status });
  }

  if (!isApprover) throw new ApiError(403, isRequester ? 'You cannot decide your own request.' : 'This request is not routed to you.');
  if (!open) throw new ApiError(409, 'This request is already closed.');

  if (body.action === 'reject' || body.action === 'ask_info') {
    const status = body.action === 'reject' ? 'rejected' : 'info_requested';
    await prisma.$transaction(async (tx) => {
      await tx.accessRequest.update({
        where: { id: r.id },
        data: { status, ...(body.action === 'reject' ? { decided_by: auth.userId, decided_at: new Date() } : {}) },
      });
      await writeEvent(tx, { orgId, requestId: r.id, type: body.action === 'reject' ? 'rejected' : 'info_asked', actorId: auth.userId, before: { status: r.status }, after: { status }, comment: body.comment, ...meta });
      await notify(tx, {
        orgId,
        userIds: [r.requester_id],
        kind: body.action === 'reject' ? 'rejected' : `info_asked:${Date.now()}`,
        requestId: r.id,
        title: body.action === 'reject' ? `${requestNumber(r.seq)} was turned down` : `${requestNumber(r.seq)}: the approver asked a question`,
        body: body.comment,
        link: '/my-access',
      });
    });
    await writeAudit({ actorId: auth.userId, action: `access.request.${status}`, entityType: 'access_request', entityId: r.id, after: { number: requestNumber(r.seq) }, metadata: { comment: body.comment }, ...meta });
    return ok({ status });
  }

  // Approve: only narrower than asked.
  const asked = r.level as RequestLevel;
  const level = (body.level ?? asked) as RequestLevel;
  const sameFamily = (r.target_type === 'tag') === (level === 'aggregate' || level === 'full');
  if (!sameFamily || LEVEL_RANK[level] > LEVEL_RANK[asked]) throw new ApiError(400, 'You can only approve the same or a narrower level than asked.');
  const durationDays = body.durationDays === undefined ? r.duration_days : body.durationDays;
  if (r.duration_days !== null && (durationDays === null || durationDays > r.duration_days)) throw new ApiError(400, 'You can only approve the same or a shorter time than asked.');
  const changed = level !== asked || durationDays !== r.duration_days;

  // Two approvals: one approver who is not a platform admin, one platform admin, different people.
  const routed = await prisma.accessRequestEvent.findFirst({ where: { request_id: r.id, type: 'routed' }, select: { after: true } });
  const twoApprovals = !!(routed?.after as { twoApprovals?: boolean } | null)?.twoApprovals;
  let complete = true;
  if (twoApprovals) {
    const admins = new Set(await platformAdminIds());
    const prior = await prisma.accessRequestEvent.findMany({ where: { request_id: r.id, type: { in: ['approved', 'approved_with_changes', 'approval_recorded'] } }, select: { actor_id: true } });
    const approvers = new Set([...prior.map((p) => p.actor_id).filter((x): x is string => !!x), auth.userId]);
    if (prior.some((p) => p.actor_id === auth.userId)) throw new ApiError(409, 'You already approved this; it needs a second approver.');
    const hasAdmin = [...approvers].some((a) => admins.has(a));
    const hasOwner = [...approvers].some((a) => !admins.has(a));
    complete = hasAdmin && hasOwner;
  }

  if (!complete) {
    await prisma.$transaction(async (tx) => {
      await writeEvent(tx, { orgId, requestId: r.id, type: 'approval_recorded', actorId: auth.userId, after: { level, durationDays, waitingFor: 'second approver' }, comment: body.comment ?? null, ...meta });
    });
    return ok({ status: r.status, waitingForSecondApproval: true });
  }

  let until: Date | null = null;
  await prisma.$transaction(async (tx) => {
    until = await grantApproved(tx, orgId, r, level, durationDays, auth.userId, requestNumber(r.seq));
    await tx.accessRequest.update({
      where: { id: r.id },
      data: { status: 'approved', decided_by: auth.userId, decided_at: new Date(), granted_until: until, level, duration_days: durationDays },
    });
    await writeEvent(tx, {
      orgId,
      requestId: r.id,
      type: changed ? 'approved_with_changes' : 'approved',
      actorId: auth.userId,
      before: { status: r.status, level: asked, durationDays: r.duration_days },
      after: { status: 'approved', level, durationDays },
      comment: body.comment ?? null,
      ...meta,
    });
    await writeEvent(tx, { orgId, requestId: r.id, type: 'granted', actorId: null, after: { until: (until as Date | null)?.toISOString() ?? null } });
    await notify(tx, {
      orgId,
      userIds: [r.requester_id],
      kind: 'approved',
      requestId: r.id,
      title: `${requestNumber(r.seq)} was approved`,
      body: (until as Date | null) ? `Access until ${(until as unknown as Date).toLocaleDateString()}.` : 'No end date.',
      link: '/my-access',
    });
  });
  evictAfterGrant(orgId);
  await writeAudit({
    actorId: auth.userId,
    action: 'access.request.approved',
    entityType: 'access_request',
    entityId: r.id,
    after: { number: requestNumber(r.seq), level, durationDays, until: (until as Date | null)?.toISOString() ?? null },
    metadata: { comment: body.comment ?? null },
    ...meta,
  });
  return ok({ status: 'approved', grantedUntil: (until as Date | null)?.toISOString() ?? null });
});
