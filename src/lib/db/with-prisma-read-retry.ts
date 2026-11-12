import { Prisma } from '@prisma/client';

/** Transient RDS / VPN reachability failure (Prisma cannot open a TCP connection). */
export function isPrismaUnreachable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P1001') {
    return true;
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    const msg = err.message ?? '';
    return msg.includes("Can't reach database server") || msg.includes('P1001');
  }
  return false;
}

/**
 * Run a read once; on P1001 wait briefly and retry (common for remote dev RDS).
 * Default: 2 attempts, 400ms backoff. Use maxAttempts for heavier paths (e.g. access policy load).
 */
export async function withPrismaReadRetry<T>(
  fn: () => Promise<T>,
  opts?: { backoffMs?: number; maxAttempts?: number },
): Promise<T> {
  const backoffMs = opts?.backoffMs ?? 400;
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 2);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isPrismaUnreachable(err) || attempt >= maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }
  throw lastErr;
}
