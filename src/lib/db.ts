import { PrismaClient } from '@prisma/client';
import { tuneDatabaseUrl } from '@/lib/db/tune-database-url';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const databaseUrl = tuneDatabaseUrl(process.env.DATABASE_URL);

function createPrisma(): PrismaClient {
  return new PrismaClient(
    databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined,
  );
}

// Reuse one client across hot reloads. Do NOT $disconnect on module re-eval — on Windows,
// Turbopack/Defender triggers more reloads than macOS; churning pools caused P1001 spikes.
export const prisma = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;