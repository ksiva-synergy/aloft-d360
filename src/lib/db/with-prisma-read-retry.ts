import { Prisma } from '@prisma/client';

/** Transient RDS / VPN reachability failure (Prisma cannot open a TCP connection). */
export function isPrismaUnreachable(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P1001';
}

/**
 * Run a read once; on P1001 wait briefly and retry exactly once (common for remote dev RDS).
 */
export async function withPrismaReadRetry<T>(
  fn: () => Promise<T>,
  opts?: { backoffMs?: number },
): Promise<T> {
  const backoffMs = opts?.backoffMs ?? 400;
  try {
    return await fn();
  } catch (err) {
    if (!isPrismaUnreachable(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return fn();
  }
}
