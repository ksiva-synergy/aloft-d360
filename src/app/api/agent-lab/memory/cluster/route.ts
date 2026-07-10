import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/org';
import { runCluster } from '@/lib/foer/run-cluster';
import { currentPeriod } from '@/lib/foer/topics';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-lab/memory/cluster
 *
 * Triggers a k-means topic-classification sweep for the org's ACTIVE memory.
 * Idempotent: re-running for the same period deletes and re-inserts topic rows.
 *
 * Body (all optional):
 *   period?:    string   — YYYY-MM period to classify (defaults to current month)
 *   mockNames?: boolean  — skip Bedrock call, derive names offline (dev/test only)
 *   force?:     boolean  — reserved, currently ignored (always runs)
 *
 * Response:
 *   ok                   boolean
 *   period               string
 *   clustersCreated      number
 *   signaturesAssigned   number
 *   signaturesTotal      number
 *   coveragePercent      number   (0–100)
 *   pullForwardTriggered boolean  (true when coverage ≥ 90%)
 *   belowMinBar          boolean  (true when coverage < 75%)
 *   warning              string | null
 *   error                string | null
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: { period?: string; mockNames?: boolean; force?: boolean } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const org    = getDefaultOrg();
  const period = body.period ?? currentPeriod();

  try {
    const result = await runCluster({
      orgId:     org.id,
      period,
      mockNames: body.mockNames ?? false,
    });

    if (!result.ok && result.error) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[memory/cluster POST]', err);
    return NextResponse.json(
      { error: 'INTERNAL', detail: String(err) },
      { status: 500 },
    );
  }
}
