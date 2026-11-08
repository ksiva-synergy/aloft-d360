/**
 * requests-maintenance.ts: run the access request checks (escalate after 3 days, expire after 14,
 * warn 3 days before access ends, record ended access). Safe to run repeatedly; schedule daily.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/access/requests-maintenance.ts
 */
import { prisma } from '@/lib/db';
import { runMaintenance } from '@/lib/access/request-maintenance';

async function main() {
  const id = process.env.DEFAULT_ORG_ID?.trim();
  const org = id
    ? { id }
    : await prisma.platformOrg.findFirst({ where: process.env.DEFAULT_ORG_SLUG ? { slug: process.env.DEFAULT_ORG_SLUG } : {}, select: { id: true } });
  if (!org) throw new Error('No org found');
  console.log(JSON.stringify(await runMaintenance(org.id)));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
