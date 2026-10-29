import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/** Remote RDS plus catalog vector scans need a longer wait than Prisma's 10s default. */
function withPoolSettings(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const limit = Number(url.searchParams.get('connection_limit') ?? '0');
    if (!limit || limit < 15) url.searchParams.set('connection_limit', '15');
    const wait = Number(url.searchParams.get('pool_timeout') ?? '0');
    if (!wait || wait < 30) url.searchParams.set('pool_timeout', '30');
    return url.toString();
  } catch {
    return raw;
  }
}

const databaseUrl = withPoolSettings(process.env.DATABASE_URL);

function createPrisma(): PrismaClient {
  return new PrismaClient(
    databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined,
  );
}

if (process.env.NODE_ENV !== 'production' && globalForPrisma.prisma) {
  void globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrisma();
globalForPrisma.prisma = prisma;

export default prisma;
