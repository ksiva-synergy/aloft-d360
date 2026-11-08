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
import { evictAccessModel } from './model-store';
import { covers } from './engine';

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
  if (req.target_type === 'tag' && req.tag_id) {
    await tx.accessTagGrant.upsert({
      where: { tag_id_principal_type_principal_id: { tag_id: req.tag_id, principal_type: 'user', principal_id: req.requester_id } },
      create: {
        org_id: orgId,
        tag_id: req.tag_id,
        principal_type: 'user',
        principal_id: req.requester_id,
        level: level === 'aggregate' ? 'aggregate' : 'full',
        expires_at: until,
        reason,
        created_by: approverId,
      },
      update: { level: level === 'aggregate' ? 'aggregate' : 'full', expires_at: until, reason, created_by: approverId },
    });
  } else if (req.target_type === 'path' && req.path) {
    const path = req.path.toLowerCase();
    const holder = { org_id: orgId, holder_type: 'person', holder_id: req.requester_id, path };
    await tx.accessRule.deleteMany({ where: { ...holder, effect: 'use' } });
    await tx.accessRule.create({
      data: {
        ...holder,
        path_depth: path.split('.').length,
        effect: 'use',
        allow_export: level === 'export',
        expires_at: until,
        reason,
        created_by: approverId,
      },
    });
  }
  await bumpPolicyVersionInTx(tx, orgId);
  return until;
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
