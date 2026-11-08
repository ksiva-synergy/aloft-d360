/**
 * In-app notices for access requests (access_notifications). One per request, person and kind:
 * repeats are skipped, so jobs can re-run safely.
 */
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export async function notify(
  tx: Tx,
  n: { orgId: string; userIds: string[]; kind: string; title: string; body?: string | null; link?: string | null; requestId?: string | null },
): Promise<void> {
  const userIds = [...new Set(n.userIds)].filter(Boolean);
  if (userIds.length === 0) return;
  await tx.accessNotification.createMany({
    data: userIds.map((user_id) => ({
      org_id: n.orgId,
      user_id,
      kind: n.kind,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      request_id: n.requestId ?? null,
    })),
    skipDuplicates: true,
  });
}
