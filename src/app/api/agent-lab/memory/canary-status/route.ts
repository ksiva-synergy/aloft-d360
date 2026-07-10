/**
 * GET /api/agent-lab/memory/canary-status
 *
 * Read-derived canary metrics for the Memory Canary panel on FoerOpsDashboard.
 * All values come from env vars + read-only DB queries — no write paths.
 *
 * Response shape:
 *   fullPoolEnabled  boolean  — whether FULLPOOL is on for this org's canary set
 *   fullPoolOrgs     string[] — the canary org allowlist (empty = all orgs)
 *   mmrLambda        number   — current MEMORY_MMR_LAMBDA value
 *   mmrEnabled       boolean  — current MEMORY_MMR_ENABLED value
 *   totalActiveBullets  number
 *   totalHelpfulCount   number  — sum of helpful_count across ACTIVE bullets
 *   totalHarmfulCount   number  — sum of harmful_count across ACTIVE bullets
 *   attributedRuns      number  — distinct run_ids with attributed_at IS NOT NULL
 *   volumeSufficient    boolean — attributedRuns >= 30 (lambda tuning threshold)
 *   computedAt          string  — ISO timestamp
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';
import { isFullPoolEnabled } from '@/lib/memory/retrieve';

export const dynamic = 'force-dynamic';

const LAMBDA_TUNE_THRESHOLD = 30;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    const orgId = org.id;

    // Flag state (env-derived, zero DB cost)
    const fullPoolEnabled = isFullPoolEnabled(orgId);
    const canaryOrgs = (process.env.MEMORY_P1B_FULLPOOL_ORGS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // isFullPoolEnabled is fail-closed: empty allowlist = nobody (not global).
    const mmrLambda  = Number(process.env.MEMORY_MMR_LAMBDA  ?? 0.7);
    const mmrEnabled = process.env.MEMORY_MMR_ENABLED === 'true';

    // Aggregate bullet counters (read-only)
    type BulletAgg = { total: bigint; helpful_sum: bigint; harmful_sum: bigint };
    const [bulletAgg] = await prisma.$queryRawUnsafe<BulletAgg[]>(`
      SELECT
        COUNT(*)::bigint                      AS total,
        COALESCE(SUM(helpful_count), 0)::bigint AS helpful_sum,
        COALESCE(SUM(harmful_count), 0)::bigint AS harmful_sum
      FROM platform_agent_memory
      WHERE org_id = $1 AND status = 'ACTIVE'
    `, orgId);

    // Attributed run count (read-only)
    type RunAgg = { attributed_runs: bigint };
    const [runAgg] = await prisma.$queryRawUnsafe<RunAgg[]>(`
      SELECT COUNT(DISTINCT run_id)::bigint AS attributed_runs
      FROM platform_memory_injections
      WHERE org_id = $1 AND attributed_at IS NOT NULL
    `, orgId);

    const totalActiveBullets = Number(bulletAgg.total);
    const totalHelpfulCount  = Number(bulletAgg.helpful_sum);
    const totalHarmfulCount  = Number(bulletAgg.harmful_sum);
    const attributedRuns     = Number(runAgg.attributed_runs);

    return NextResponse.json({
      fullPoolEnabled,
      fullPoolOrgs:    canaryOrgs,
      mmrLambda,
      mmrEnabled,
      totalActiveBullets,
      totalHelpfulCount,
      totalHarmfulCount,
      attributedRuns,
      volumeSufficient: attributedRuns >= LAMBDA_TUNE_THRESHOLD,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[memory/canary-status GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
