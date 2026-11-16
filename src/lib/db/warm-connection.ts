import prisma from '@/lib/db';

/**
 * On remote RDS over flaky TCP (common on Windows home/office internet), the first
 * connection may need several attempts (~21s ETIMEDOUT per try). Warm once at server
 * start so the UI does not open ten parallel API calls while the pool is still empty.
 */
export async function warmPrismaConnection(): Promise<boolean> {
  const raw = process.env.DATABASE_URL ?? '';
  if (process.env.NODE_ENV === 'production' || !/\.rds\.amazonaws\.com/i.test(raw)) {
    return true;
  }
  const max = Math.max(1, Number(process.env.PRISMA_WARM_ATTEMPTS ?? 12) || 12);
  const baseDelay = Math.max(500, Number(process.env.PRISMA_WARM_DELAY_MS ?? 2500) || 2500);

  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(`[prisma] warm connection ready (attempt ${attempt}/${max})`);
      return true;
    } catch (err) {
      if (attempt >= max) {
        console.error(`[prisma] warm connection failed after ${attempt} attempt(s):`, err);
        return false;
      }
      const delay = Math.min(baseDelay * attempt, 20_000);
      console.warn(
        `[prisma] warm attempt ${attempt}/${max} (remote RDS TCP) — retry in ${delay}ms…`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return false;
}