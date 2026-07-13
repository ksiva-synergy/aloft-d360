/**
 * backfill-inspector-contributions.ts — one-time seed so the Memory
 * Contributions leaderboard isn't empty on a fresh estate.
 *
 * The board (GET /api/agent-lab/memory/leaderboard) is driven entirely by
 * platform_user_reputation, which is only ever written when a contribution is
 * recorded. On a fresh estate we have synthesised `inspector` memories but no
 * contribution/reputation rows, so the card shows "0 contributors".
 *
 * This attributes every existing ACTIVE `inspector` memory to the Admin user as
 * an INSERT_AUTHOR contribution, driving the real store path
 * (recordContribution → CONTRIBUTED outcome → reputation upsert → contributor_rep
 * refresh). It is idempotent: contributions ON CONFLICT DO NOTHING, and re-runs
 * only re-bank capped daily XP.
 *
 * Usage (repo root, staging/local env):
 *   MEMORY_REPUTATION_ENABLED=true node --env-file=.env.local \
 *     node_modules/tsx/dist/cli.mjs scripts/backfill-inspector-contributions.ts
 */

import { prisma } from '@/lib/prisma';
import { recordContribution } from '@/lib/memory/reputation/store';

const ADMIN_USER_ID = 'cmpm8fyyl0000ufuc2adzxkah'; // "Admin" (admin@spinorlabs.io)
const DOMAIN = 'inspector';

async function main() {
  const slug = process.env.DEFAULT_ORG_SLUG;
  const org = await prisma.platformOrg.findFirstOrThrow({ where: { slug } });

  const admin = await prisma.user.findUniqueOrThrow({
    where: { id: ADMIN_USER_ID },
    select: { id: true, name: true, email: true },
  });
  console.log(`Attributing ${DOMAIN} memories to ${admin.name} (${admin.email}) in org ${org.slug}`);

  const mems = await prisma.$queryRaw<Array<{ id: string; source_session_ids: string[] }>>`
    SELECT id, source_session_ids
    FROM platform_agent_memory
    WHERE org_id = ${org.id} AND agent_class = ${DOMAIN} AND status = 'ACTIVE'
    ORDER BY created_at ASC
  `;
  console.log(`Found ${mems.length} active ${DOMAIN} memories`);

  let done = 0;
  for (const m of mems) {
    await recordContribution({
      orgId: org.id,
      memoryId: m.id,
      domain: DOMAIN,
      sessionId: m.source_session_ids?.[0] ?? '', // provenance only; '' when unknown
      userId: ADMIN_USER_ID, // pass explicitly — no session→user resolution needed
      type: 'INSERT_AUTHOR', // → CONTRIBUTED participation credit
    });
    if (++done % 50 === 0) console.log(`  …${done}/${mems.length}`);
  }

  // Report the resulting reputation row so we can eyeball the board outcome.
  const rep = await prisma.$queryRaw<
    Array<{ role: string; pos: number; neg: number; season_xp: number }>
  >`
    SELECT role, pos, neg, season_xp FROM platform_user_reputation
    WHERE org_id = ${org.id} AND user_id = ${ADMIN_USER_ID} AND domain = ${DOMAIN}
  `;
  const contribCount = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM platform_memory_contributions
    WHERE org_id = ${org.id} AND user_id = ${ADMIN_USER_ID} AND domain = ${DOMAIN}
  `;
  console.log(`Done. Contribution rows: ${Number(contribCount[0]?.n ?? 0)}`);
  console.log('Reputation row:', rep[0] ?? '(none)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
