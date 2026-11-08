/**
 * Access request housekeeping (E9-T6), run on a schedule or with "Run checks now".
 *
 *   escalate        open for 3+ days and not escalated yet → add platform admins as approvers
 *   expire          open for 14+ days → status expired
 *   expiring_soon   approved access ends within 3 days → notify the person once
 *   access_ended    approved access has ended → record it once
 *
 * `planMaintenance` is pure (tested with a fake clock); `runMaintenance` applies the plan.
 * Ended access needs no deletion: every decision already ignores expired grants and rules.
 */
import { prisma } from '@/lib/db';
import { notify } from './notifications';
import { OPEN_STATUSES, platformAdminIds, requestNumber, writeEvent } from './requests';

export const ESCALATE_AFTER_MS = 3 * 86_400_000;
export const EXPIRE_AFTER_MS = 14 * 86_400_000;
export const WARN_BEFORE_MS = 3 * 86_400_000;

export interface MaintRequest {
  id: string;
  status: string;
  created_at: Date;
  granted_until: Date | null;
  requester_id: string;
  routed_to: string[];
}

export type MaintAction =
  | { kind: 'escalate'; requestId: string }
  | { kind: 'expire'; requestId: string }
  | { kind: 'expiring_soon'; requestId: string }
  | { kind: 'access_ended'; requestId: string };

export function planMaintenance(requests: MaintRequest[], eventTypesByRequest: Map<string, Set<string>>, now: number): MaintAction[] {
  const actions: MaintAction[] = [];
  for (const r of requests) {
    const seen = eventTypesByRequest.get(r.id) ?? new Set<string>();
    const age = now - r.created_at.getTime();
    if (OPEN_STATUSES.includes(r.status as never)) {
      if (age >= EXPIRE_AFTER_MS) actions.push({ kind: 'expire', requestId: r.id });
      else if (age >= ESCALATE_AFTER_MS && !seen.has('escalated')) actions.push({ kind: 'escalate', requestId: r.id });
    } else if (r.status === 'approved' && r.granted_until) {
      const left = r.granted_until.getTime() - now;
      if (left <= 0 && !seen.has('access_ended')) actions.push({ kind: 'access_ended', requestId: r.id });
      else if (left > 0 && left <= WARN_BEFORE_MS && !seen.has('expiring_soon')) actions.push({ kind: 'expiring_soon', requestId: r.id });
    }
  }
  return actions;
}

export async function runMaintenance(orgId: string, now: number = Date.now()): Promise<Record<MaintAction['kind'], number>> {
  const requests = await prisma.accessRequest.findMany({
    where: {
      org_id: orgId,
      OR: [{ status: { in: OPEN_STATUSES } }, { status: 'approved', granted_until: { not: null } }],
    },
    select: { id: true, seq: true, status: true, created_at: true, granted_until: true, requester_id: true, routed_to: true, path: true, tag_id: true },
  });
  const events = requests.length
    ? await prisma.accessRequestEvent.findMany({ where: { request_id: { in: requests.map((r) => r.id) } }, select: { request_id: true, type: true } })
    : [];
  const seen = new Map<string, Set<string>>();
  for (const e of events) seen.set(e.request_id, (seen.get(e.request_id) ?? new Set()).add(e.type));

  const actions = planMaintenance(requests, seen, now);
  const counts = { escalate: 0, expire: 0, expiring_soon: 0, access_ended: 0 };
  const admins = actions.some((a) => a.kind === 'escalate') ? await platformAdminIds() : [];
  const byId = new Map(requests.map((r) => [r.id, r]));

  for (const a of actions) {
    const r = byId.get(a.requestId)!;
    const number = requestNumber(r.seq);
    await prisma.$transaction(async (tx) => {
      if (a.kind === 'escalate') {
        const added = admins.filter((id) => id !== r.requester_id && !r.routed_to.includes(id));
        await tx.accessRequest.update({ where: { id: r.id }, data: { routed_to: [...r.routed_to, ...added] } });
        await writeEvent(tx, { orgId, requestId: r.id, type: 'escalated', actorId: null, after: { added }, comment: 'No answer for 3 days; sent to platform admins too' });
        await notify(tx, { orgId, userIds: added, kind: 'escalated', requestId: r.id, title: `${number} needs a decision`, body: 'Nobody answered for 3 days.', link: '/agent-staging/data-access?tab=log' });
      } else if (a.kind === 'expire') {
        await tx.accessRequest.update({ where: { id: r.id }, data: { status: 'expired' } });
        await writeEvent(tx, { orgId, requestId: r.id, type: 'expired', actorId: null, before: { status: r.status }, after: { status: 'expired' }, comment: 'No decision in 14 days' });
        await notify(tx, { orgId, userIds: [r.requester_id], kind: 'expired', requestId: r.id, title: `${number} expired without a decision`, body: 'You can ask again.', link: '/my-access' });
      } else if (a.kind === 'expiring_soon') {
        await writeEvent(tx, { orgId, requestId: r.id, type: 'expiring_soon', actorId: null, after: { until: r.granted_until?.toISOString() } });
        await notify(tx, {
          orgId,
          userIds: [r.requester_id],
          kind: 'expiring_soon',
          requestId: r.id,
          title: `Your access from ${number} ends ${r.granted_until!.toLocaleDateString()}`,
          body: 'Ask to extend if you still need it.',
          link: r.path ? `/my-access?path=${encodeURIComponent(r.path)}` : r.tag_id ? `/my-access?tag=${encodeURIComponent(r.tag_id)}` : '/my-access',
        });
      } else {
        await writeEvent(tx, { orgId, requestId: r.id, type: 'access_ended', actorId: null, after: { until: r.granted_until?.toISOString() } });
      }
    });
    counts[a.kind]++;
  }
  return counts;
}
