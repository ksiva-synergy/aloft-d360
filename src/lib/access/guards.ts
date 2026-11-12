import { ApiError } from '@/lib/http';
import { withPrismaReadRetry } from '@/lib/db/with-prisma-read-retry';

/** RDS / VPN flake on remote dev — use for access admin reads and writes. */
export function withAccessDbRetry<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return withPrismaReadRetry(fn, { maxAttempts: 3, backoffMs: 500 });
}

/** Separation of duties: admins cannot grant data access to themselves. */
export function assertNotSelfUserGrant(actorId: string, principalType: string, principalId: string): void {
  if (principalType === 'user' && principalId === actorId) {
    throw new ApiError(403, 'You cannot change your own data grants');
  }
}

export function assertNotSelfClearance(actorId: string, targetUserId: string): void {
  if (actorId === targetUserId) {
    throw new ApiError(403, 'You cannot change your own clearance');
  }
}
