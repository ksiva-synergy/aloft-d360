/**
 * Delete tool_invocation_log rows older than AGENT_OPS_RETENTION_DAYS (default 90).
 * Usage: node scripts/agent-ops-retention.mjs
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: '.env' });

const days = parseInt(process.env.AGENT_OPS_RETENTION_DAYS ?? '90', 10);
const prisma = new PrismaClient();

const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - days);

const result = await prisma.tool_invocation_log.deleteMany({
  where: { created_at: { lt: cutoff } },
});

console.log(`[agent-ops-retention] deleted ${result.count} rows older than ${days} days (before ${cutoff.toISOString()})`);
await prisma.$disconnect();
