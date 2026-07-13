/**
 * reputation-smoke.ts — turnkey Phase A step-3 verification.
 *
 * Run against a STAGING database (never prod). Seeds minimal rows, drives the
 * real store functions the pipeline will call, and asserts the things that
 * actually matter:
 *
 *   1. run_id -> user_id resolves          (the load-bearing join; silent-null catch)
 *   2. anonymous / unbound sessions no-op  (no rows, no throw)
 *   3. per-domain divergence               (helpful in A, harmful in B => vector rep)
 *   4. contribution rows + contributor_rep move off 1.0 on a real contribution
 *
 * Usage (from repo root, with staging env loaded):
 *   MEMORY_REPUTATION_ENABLED=true npx tsx scripts/reputation-smoke.ts
 *
 * Safe to re-run: it tags everything with a dedicated org id and cleans up.
 *
 * Note: no User row is seeded. `workbench_sessions.user_id` is a plain string
 * with no FK to the User table, and resolveContributorUserId() reads it directly,
 * so the join resolves without a matching User row.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import {
  resolveContributorUserId,
  recordContribution,
  attributeOutcomeForRun,
  getDomainReputation,
} from '@/lib/memory/reputation/store';
import { ROLE_PRIORS, DEFAULT_ROLE } from '@/lib/memory/reputation/engine';

const ORG = 'test_org_reputation_smoke';
const DOMAIN_A = 'billing'; // agent_class where the user does well
const DOMAIN_B = 'auth'; // agent_class where the user does badly
const PRIOR = ROLE_PRIORS[DEFAULT_ROLE].mean; // member prior (0.55) — resolveRole() stub

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

// --- seed helpers (raw SQL so we don't depend on Prisma model names) ---------

async function seedSession(userId: string | null): Promise<string> {
  const sid = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO workbench_sessions (id, user_id, surface)
    VALUES (${sid}::uuid, ${userId}, 'inspector')
  `;
  return sid;
}
// Every NOT NULL column without a DB default under `prisma db push` is set
// explicitly. In particular updated_at (@updatedAt) is client-side only, so it
// has no DB default; source_session_ids/version/status/valid_from are set too
// rather than trusting push-generated defaults.
async function seedBullet(id: string, agentClass: string) {
  await prisma.$executeRaw`
    INSERT INTO platform_agent_memory
      (id, org_id, agent_class, rule_text, rule_type, confidence, version, status,
       source_session_ids, contributor_rep, valid_from, created_at, updated_at)
    VALUES
      (${id}, ${ORG}, ${agentClass}, 'smoke test rule', 'HEURISTIC', 0.5, 1, 'ACTIVE',
       ARRAY[]::text[], 1.0, now(), now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
}
async function bulletRep(id: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ contributor_rep: number }>>`
    SELECT contributor_rep FROM platform_agent_memory WHERE id = ${id}
  `;
  return Number(rows[0]?.contributor_rep);
}
async function contributionCount(memoryId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM platform_memory_contributions WHERE memory_id = ${memoryId}
  `;
  return Number(rows[0]?.n ?? 0);
}
async function reputationRowExists(userId: string, domain: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM platform_user_reputation
    WHERE org_id = ${ORG} AND user_id = ${userId} AND domain = ${domain}
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function cleanup(sessionIds: string[]) {
  await prisma.$executeRaw`DELETE FROM platform_memory_contributions WHERE org_id = ${ORG}`;
  await prisma.$executeRaw`DELETE FROM platform_user_reputation WHERE org_id = ${ORG}`;
  await prisma.$executeRaw`DELETE FROM platform_agent_memory WHERE org_id = ${ORG}`;
  for (const s of sessionIds) await prisma.$executeRaw`DELETE FROM workbench_sessions WHERE id = ${s}::uuid`;
}

// --- main --------------------------------------------------------------------

async function main() {
  if (process.env.MEMORY_REPUTATION_ENABLED !== 'true') {
    console.log('MEMORY_REPUTATION_ENABLED is not "true" — set it before running.');
    throw new Error('flag not enabled');
  }

  const userId = 'smoke_user_' + randomUUID().slice(0, 8);
  const bulletA = 'smoke_bullet_A_' + randomUUID().slice(0, 8);
  const bulletB = 'smoke_bullet_B_' + randomUUID().slice(0, 8);
  const bulletAnon = 'smoke_bullet_anon_' + randomUUID().slice(0, 8);

  const created = { sessions: [] as string[] };

  try {
    await seedBullet(bulletA, DOMAIN_A);
    await seedBullet(bulletB, DOMAIN_B);
    await seedBullet(bulletAnon, DOMAIN_A);

    const boundSession = await seedSession(userId);
    const nullSession = await seedSession(null);
    const anonSession = await seedSession('anonymous');
    created.sessions.push(boundSession, nullSession, anonSession);

    // 1. run_id -> user_id resolution (this is what the pipeline feeds run_id into).
    check('bound session resolves to its user', (await resolveContributorUserId(boundSession)) === userId);
    check('null-user session resolves to null', (await resolveContributorUserId(nullSession)) === null);
    check("'anonymous' session resolves to null", (await resolveContributorUserId(anonSession)) === null);

    // 3. Per-domain divergence: helpful in A (x3), harmful in B (x1).
    for (let i = 0; i < 3; i++) {
      await attributeOutcomeForRun({ orgId: ORG, sessionId: boundSession, memoryId: bulletA, outcome: 'HELPFUL' });
    }
    await attributeOutcomeForRun({ orgId: ORG, sessionId: boundSession, memoryId: bulletB, outcome: 'HARMFUL' });

    const repA = await getDomainReputation(ORG, userId, DOMAIN_A);
    const repB = await getDomainReputation(ORG, userId, DOMAIN_B);
    check('helpful domain rises above prior', repA.mean > PRIOR, `A=${repA.mean.toFixed(3)} prior=${PRIOR}`);
    check('harmful domain falls below prior', repB.mean < PRIOR, `B=${repB.mean.toFixed(3)}`);
    check('per-domain divergence (A > B)', repA.mean > repB.mean, `A=${repA.mean.toFixed(3)} B=${repB.mean.toFixed(3)}`);

    // 2. Anonymous outcome writes nothing (silent-null path must not create rows).
    await attributeOutcomeForRun({ orgId: ORG, sessionId: anonSession, memoryId: bulletAnon, outcome: 'HELPFUL' });
    check('bound session created a reputation row', await reputationRowExists(userId, DOMAIN_A));
    check('anonymous run created NO contribution rows', (await contributionCount(bulletAnon)) === 0);

    // 4. A real contribution writes a row and moves contributor_rep off 1.0.
    const repBefore = await bulletRep(bulletA);
    await recordContribution({ orgId: ORG, memoryId: bulletA, domain: DOMAIN_A, sessionId: boundSession, type: 'INSERT_AUTHOR' });
    const repAfter = await bulletRep(bulletA);
    check('contribution row recorded', (await contributionCount(bulletA)) >= 1);
    check('contributor_rep moved off default 1.0', Math.abs(repAfter - 1.0) > 1e-6, `before=${repBefore} after=${repAfter}`);

    // Anonymous contribution attempt: still no rows.
    await recordContribution({ orgId: ORG, memoryId: bulletAnon, domain: DOMAIN_A, sessionId: anonSession, type: 'INSERT_AUTHOR' });
    check('anonymous contribution is a no-op', (await contributionCount(bulletAnon)) === 0);
    check('anonymous bullet contributor_rep stayed 1.0', Math.abs((await bulletRep(bulletAnon)) - 1.0) < 1e-6);
  } finally {
    await cleanup(created.sessions);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? 'SMOKE TEST PASSED' : failures + ' CHECK(S) FAILED'}`);
  if (failures > 0) throw new Error(`${failures} smoke check(s) failed`);
}

main().catch((e) => {
  console.error(e);
  throw e;
});
