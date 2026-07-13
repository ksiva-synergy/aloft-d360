/**
 * Append-only audit trail writer. Call `writeAudit(...)` on every mutating path
 * (role assignment, user deactivation, session deletion, ...). Failures are
 * swallowed and logged — recording an audit event must never break the request
 * it is auditing.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface AuditInput {
  /** Acting user id (User.id, cuid/text). Null = system / automated. */
  actorId?: string | null;
  action: string; // e.g. "user.role.assigned", "session.deleted"
  entityType: string;
  entityId?: string | null;
  sessionId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

const asJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined || v === null ? undefined : (v as Prisma.InputJsonValue);

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        sessionId: input.sessionId ?? null,
        ...(asJson(input.before) !== undefined ? { before: asJson(input.before) } : {}),
        ...(asJson(input.after) !== undefined ? { after: asJson(input.after) } : {}),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        ...(asJson(input.metadata) !== undefined ? { metadata: asJson(input.metadata) } : {}),
      },
    });
  } catch (e) {
    console.error('[audit] failed to write audit log', e);
  }
}
