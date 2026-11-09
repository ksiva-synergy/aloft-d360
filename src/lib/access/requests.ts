/**
 * Access requests (S4; docs/access/simplified-access-model.md §3.4, pii-protection-backlog.md §7.4–§7.6).
 *
 * A person asks for:
 *   - a protection (tag), at Totals only or Exact values, or
 *   - a catalog / schema / table, to Use or Use + export.
 * Routing (never the requester):
 *   protection → approvers (owners) of every group that holds the protection; tags marked two-approvals
 *                also need a platform admin
 *   path       → approvers of groups whose Use rule covers the path
 *   fallback   → platform admins
 * Approval grants the person directly, with an end date: a protection grant, or a Use rule.
 * Every step is an append-only event (access_request_events; a trigger refuses UPDATE / DELETE).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import { bumpPolicyVersionInTx, evictPolicySnapshot, readPolicyVersion } from './policy-store';
import { evictAccessModel, loadAccessModel } from './model-store';
import { covers, previewPathGrant } from './engine';
import { loadUserRoleNames } from './roles';

type Tx = Prisma.TransactionClient;

export type RequestStatus = 'pending' | 'info_requested' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type RequestLevel = 'aggregate' | 'full' | 'query' | 'export';
export const OPEN_STATUSES: RequestStatus[] = ['pending', 'info_requested'];
export const MAX_OPEN_PER_TARGET = 3;
export const REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface RequestTarget {
  targetType: 'tag' | 'path';
  tagId?: string | null;
  path?: string | null;
}

export async function platformAdminIds(): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: { role: { name: 'platform_admin' }, user: { deletedAt: null } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Who decides. `needsPlatformAdmin` is true when a platform admin must also approve (two approvals),
 * or when the only route is platform admins.
 */
export async function routeRequest(
  orgId: string,
  requesterId: string,
  target: RequestTarget,
): Promise<{ approvers: string[]; needsPlatformAdmin: boolean; twoApprovals: boolean }> {
  const admins = (await platformAdminIds()).filter((id) => id !== requesterId);
  let groupIds: string[] = [];
  let twoApprovals = false;

  if (target.targetType === 'tag' && target.tagId) {
    const [tag, grants] = await Promise.all([
      prisma.accessTag.findFirst({ where: { id: target.tagId, org_id: orgId }, select: { requires_two_approvals: true } }),
      prisma.accessTagGrant.findMany({ where: { org_id: orgId, tag_id: target.tagId, principal_type: 'group' }, select: { principal_id: true } }),
    ]);
    twoApprovals = !!tag?.requires_two_approvals;
    groupIds = grants.map((g) => g.principal_id);
  } else if (target.targetType === 'path' && target.path) {
    const rules = await prisma.accessRule.findMany({
      where: { org_id: orgId, holder_type: 'group', effect: 'use' },
      select: { holder_id: true, path: true },
    });
    groupIds = rules.filter((r) => covers(r.path, target.path!)).map((r) => r.holder_id);
  }

  // Approvers are the owners of the (active) groups that hold the protection or cover the path.
  const activeGroupIds = groupIds.length
    ? (await prisma.accessGroup.findMany({ where: { id: { in: [...new Set(groupIds)] }, archived_at: null }, select: { id: true } })).map((g) => g.id)
    : [];
  const ownerRows = activeGroupIds.length
    ? await prisma.accessGroupOwner.findMany({ where: { group_id: { in: activeGroupIds } }, select: { user_id: true } })
    : [];
  const ownerIds = [...new Set(ownerRows.map((o) => o.user_id))].filter((id) => id !== requesterId);

  if (ownerIds.length === 0) return { approvers: admins, needsPlatformAdmin: true, twoApprovals: false };
  if (twoApprovals) return { approvers: [...new Set([...ownerIds, ...admins])], needsPlatformAdmin: true, twoApprovals: true };
  return { approvers: ownerIds, needsPlatformAdmin: false, twoApprovals: false };
}

export interface EventInput {
  orgId: string;
  requestId: string;
  type: string;
  actorId: string | null;
  before?: unknown;
  after?: unknown;
  comment?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writeEvent(tx: Tx, e: EventInput): Promise<void> {
  await tx.accessRequestEvent.create({
    data: {
      org_id: e.orgId,
      request_id: e.requestId,
      type: e.type,
      actor_id: e.actorId,
      before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
      comment: e.comment ?? null,
      ip_address: e.ipAddress ?? null,
      user_agent: e.userAgent ?? null,
      policy_version: await readPolicyVersion(e.orgId).catch(() => null),
    },
  });
}

/** Refuse duplicate open requests and quick re-requests after a rejection. */
export async function assertCanRequest(orgId: string, requesterId: string, target: RequestTarget): Promise<void> {
  const where = {
    org_id: orgId,
    requester_id: requesterId,
    target_type: target.targetType,
    ...(target.targetType === 'tag' ? { tag_id: target.tagId } : { path: target.path }),
  };
  const open = await prisma.accessRequest.count({ where: { ...where, status: { in: OPEN_STATUSES } } });
  if (open >= MAX_OPEN_PER_TARGET) throw new ApiError(409, 'You already have open requests for this. Wait for a decision.');
  if (open > 0) throw new ApiError(409, 'You already asked for this; it is waiting for a decision.');
  const lastRejected = await prisma.accessRequest.findFirst({
    where: { ...where, status: 'rejected' },
    orderBy: { decided_at: 'desc' },
    select: { decided_at: true },
  });
  if (lastRejected?.decided_at && Date.now() - lastRejected.decided_at.getTime() < REJECT_COOLDOWN_MS) {
    throw new ApiError(429, 'This was turned down in the last 24 hours. Talk to the approver, or try again later.');
  }
}

/** Grant what was approved, directly to the requester, with an end date. Returns the end date. */
export async function grantApproved(
  tx: Tx,
  orgId: string,
  req: { requester_id: string; target_type: string; tag_id: string | null; path: string | null },
  level: RequestLevel,
  durationDays: number | null,
  approverId: string,
  requestId: string,
): Promise<Date | null> {
  const until = durationDays ? new Date(Date.now() + durationDays * 86_400_000) : null;
  const reason = `Approved request ${requestId}`;
  // Review H5: approval only ever widens access. Existing access that is wider (export, Exact values,
  // a later or no end date) is kept rather than replaced.
  let effectiveUntil = until;
  if (req.target_type === 'tag' && req.tag_id) {
    const key = { tag_id: req.tag_id, principal_type: 'user', principal_id: req.requester_id };
    const existing = live(await tx.accessTagGrant.findUnique({ where: { tag_id_principal_type_principal_id: key } }));
    const approved = level === 'aggregate' ? 'aggregate' : 'full';
    const merged = existing?.level === 'full' ? 'full' : approved;
    effectiveUntil = laterEnd(existing, until);
    await tx.accessTagGrant.upsert({
      where: { tag_id_principal_type_principal_id: key },
      create: { org_id: orgId, ...key, level: merged, expires_at: effectiveUntil, reason, created_by: approverId },
      update: { level: merged, expires_at: effectiveUntil, reason, created_by: approverId },
    });
  } else if (req.target_type === 'path' && req.path) {
    const path = req.path.toLowerCase();
    const holder = { org_id: orgId, holder_type: 'person', holder_id: req.requester_id, path };
    const existing = (await tx.accessRule.findMany({ where: { ...holder, effect: 'use' } }))
      .map((r) => live(r))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const allowExport = level === 'export' || existing.some((r) => r.allow_export);
    effectiveUntil = existing.reduce<Date | null>((acc, r) => laterEnd(r, acc), until);
    await tx.accessRule.deleteMany({ where: { ...holder, effect: 'use' } });
    await tx.accessRule.create({
      data: {
        ...holder,
        path_depth: path.split('.').length,
        effect: 'use',
        allow_export: allowExport,
        expires_at: effectiveUntil,
        reason,
        created_by: approverId,
      },
    });
  }
  await bumpPolicyVersionInTx(tx, orgId);
  return effectiveUntil;
}

/** The row, or null when it has already expired. */
function live<T extends { expires_at: Date | null }>(row: T | null): T | null {
  return row && (!row.expires_at || row.expires_at.getTime() > Date.now()) ? row : null;
}

/** The later of two end dates; no end date (null) beats any date. A missing row contributes nothing. */
function laterEnd(existing: { expires_at: Date | null } | null, until: Date | null): Date | null {
  if (!existing) return until;
  if (existing.expires_at === null || until === null) return null;
  return existing.expires_at > until ? existing.expires_at : until;
}

/**
 * Review H6: refuse to approve Use on a path when the person still couldn't open it afterwards.
 * - A Block on the path or a parent always wins: the Block must be removed first.
 * - A whole-path protection must also be held; approval is allowed only when the person already
 *   has an open request for every missing protection, so the gap is visible and being handled.
 * Throws ApiError(409) with what is missing; returns quietly when the approval will work.
 */
export async function assertApprovalTakesEffect(
  orgId: string,
  req: { requester_id: string; target_type: string; path: string | null },
  level: RequestLevel,
): Promise<void> {
  if (req.target_type !== 'path' || !req.path) return;
  const [model, roles] = await Promise.all([loadAccessModel(orgId), loadUserRoleNames(req.requester_id)]);
  const preview = previewPathGrant(model, { userId: req.requester_id, roles }, req.path, level === 'export' ? 'export' : 'use');
  if (preview.ok) return;
  if (preview.reason === 'blocked') {
    throw new ApiError(
      409,
      `Approving would not give access: ${preview.blockedBy.join(', ') || 'a parent path'} is blocked for this person, and a Block always wins. Remove that Block first, or turn this request down.`,
    );
  }
  const open = await prisma.accessRequest.findMany({
    where: { org_id: orgId, requester_id: req.requester_id, target_type: 'tag', status: { in: [...OPEN_STATUSES] } },
    select: { tag_id: true },
  });
  const requested = new Set(open.map((o) => o.tag_id));
  const missing = preview.protections.filter((p) => !requested.has(p.id));
  if (missing.length) {
    throw new ApiError(
      409,
      `Approving would not give access: this data is also protected by ${missing.map((p) => p.name).join(', ')}, which the person doesn't hold. Ask them to request ${missing.length === 1 ? 'it' : 'them'} too, then approve both.`,
    );
  }
}

/**
 * An approver who isn't a platform admin can approve only up to what the groups they own hold
 * (review: approvers granting more than they hold). An owner of a "Totals only" group can't approve
 * "Exact values"; an owner of a group with Use but not export can't approve export.
 */
export async function assertApproverCanGrant(
  orgId: string,
  approverId: string,
  req: { target_type: string; tag_id: string | null; path: string | null },
  level: RequestLevel,
): Promise<void> {
  const owned = new Set(
    (await prisma.accessGroupOwner.findMany({ where: { user_id: approverId }, select: { group_id: true } })).map((o) => o.group_id),
  );
  const model = await loadAccessModel(orgId);
  const now = Date.now();
  const live = (d: Date | null) => !d || d.getTime() > now;
  if (req.target_type === 'tag' && req.tag_id) {
    const best = model.protectionGrants
      .filter((g) => g.protectionId === req.tag_id && g.holder.kind === 'group' && owned.has(g.holder.id) && live(g.expiresAt))
      .reduce((acc, g) => (g.level === 'full' ? 'full' : acc === 'full' ? 'full' : 'aggregate'), 'none' as 'none' | 'aggregate' | 'full');
    const ok = level === 'aggregate' ? best !== 'none' : best === 'full';
    if (!ok) {
      throw new ApiError(
        403,
        best === 'aggregate'
          ? 'Your group has Totals only for this protection, so you can approve Totals only. Exact values needs a platform admin.'
          : 'None of your groups hold this protection. A platform admin must approve it.',
      );
    }
  } else if (req.target_type === 'path' && req.path) {
    const p = req.path.toLowerCase();
    const rules = model.rules.filter(
      (r) => r.effect === 'use' && r.holder.kind === 'group' && owned.has(r.holder.id) && covers(r.path, p) && live(r.expiresAt),
    );
    if (rules.length === 0) throw new ApiError(403, 'None of your groups have Use on this data. A platform admin must approve it.');
    if (level === 'export' && !rules.some((r) => r.allowExport)) {
      throw new ApiError(403, 'Your group can use this data but not export it. Approve Use only, or ask a platform admin.');
    }
  }
}

export function evictAfterGrant(orgId: string): void {
  evictPolicySnapshot(orgId);
  evictAccessModel(orgId);
}

/** ACC-0042 */
export const requestNumber = (seq: bigint | number) => `ACC-${String(seq).padStart(4, '0')}`;

/**
 * Auto-approve (A4): a table request is approved at once when a rule with auto_approve covers the path,
 * allows what was asked (export needs allow_export), and the path is not protected as a whole.
 */
export async function autoApprovable(orgId: string, path: string, level: RequestLevel): Promise<boolean> {
  const p = path.toLowerCase();
  const [rules, protections] = await Promise.all([
    prisma.accessRule.findMany({ where: { org_id: orgId, effect: 'use', auto_approve: true }, select: { path: true, allow_export: true } }),
    prisma.accessPathProtection.findMany({ where: { org_id: orgId }, select: { path: true } }),
  ]);
  if (protections.some((x) => covers(x.path, p))) return false;
  return rules.some((r) => covers(r.path, p) && (level !== 'export' || r.allow_export));
}
