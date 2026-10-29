import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { computePipelineIntent, normalizePipelineScope } from '@/lib/estate/pipeline-intent';
import { LaunchSourceNotFoundError, resolveLaunchSources } from '@/lib/context/resolve-launch-source';
import { denyUnlessEstatePipelineOperator } from '@/lib/estate/require-estate-pipeline-operator';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-lab/context/pipeline/continue
 *
 * Computes scoped pipeline intent and launches minimum stale tiers via jobs/launch logic.
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessEstatePipelineOperator();
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const through = body.through === 't2_semantic' || body.through === 'embed' ? body.through : 't1_profile';
  const includePatterns: string[] = Array.isArray(body.includePatterns) ? body.includePatterns : [];
  const catalog = typeof body.catalog === 'string' ? body.catalog : undefined;
  const schema = typeof body.schema === 'string' ? body.schema : undefined;
  const requestedSourceId =
    typeof body.sourceId === 'string' ? body.sourceId : undefined;

  try {
    const orgId = await getOrgId();
    const sources = await resolveLaunchSources(orgId, requestedSourceId);
    const source = sources[0];
    if (!source) {
      return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 });
    }

    const scope = normalizePipelineScope({
      sourceId: source.id,
      includePatterns,
      catalog,
      schema,
    });

    const intent = await computePipelineIntent(
      orgId,
      { sourceId: source.id, ...scope, catalog, schema },
      { through },
    );

    if (intent.recommendedKinds.length === 0) {
      return NextResponse.json(
        {
          error: 'NOTHING_TO_RUN',
          message: intent.humanSummary,
          intent,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      intent,
      launchPayload: {
        kinds: intent.recommendedKinds,
        includePatterns: intent.includePatterns,
        excludeSchemas: [],
        sequential: intent.sequential,
        sourceId: source.id,
        uiSurface: 'scanned_continue',
      },
    });
  } catch (err) {
    if (err instanceof LaunchSourceNotFoundError) {
      return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 });
    }
    console.error('[context/pipeline/continue POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
