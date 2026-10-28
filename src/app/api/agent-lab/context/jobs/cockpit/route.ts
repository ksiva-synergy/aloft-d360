import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { getJobRecommendations } from '@/lib/estate/cockpit';
import { computePipelineIntent, normalizePipelineScope } from '@/lib/estate/pipeline-intent';
import { LaunchSourceNotFoundError, resolveLaunchSources } from '@/lib/context/resolve-launch-source';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const orgId = await getOrgId();
    const sourceId = req.nextUrl.searchParams.get('sourceId') ?? undefined;
    const catalog = req.nextUrl.searchParams.get('catalog') ?? undefined;
    const schema = req.nextUrl.searchParams.get('schema') ?? undefined;
    const throughParam = req.nextUrl.searchParams.get('through');
    const through =
      throughParam === 't2_semantic' || throughParam === 'embed' || throughParam === 't1_profile'
        ? throughParam
        : 'embed';
    const includePatternsParam = req.nextUrl.searchParams.getAll('includePatterns');

    const scoped = Boolean(catalog || includePatternsParam.length > 0);

    if (scoped) {
      const sources = await resolveLaunchSources(orgId, sourceId);
      const source = sources[0];
      if (!source) {
        return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 });
      }
      const scope = normalizePipelineScope({
        sourceId: source.id,
        catalog,
        schema,
        includePatterns: includePatternsParam,
      });
      const intent = await computePipelineIntent(
        orgId,
        { sourceId: source.id, ...scope, catalog, schema },
        { through },
      );
      return NextResponse.json({
        health: intent.health,
        recommendation: intent.recommendation,
        intent,
      });
    }

    const { health, primary } = await getJobRecommendations(orgId, sourceId || undefined);
    return NextResponse.json({ health, recommendation: primary });
  } catch (err) {
    if (err instanceof LaunchSourceNotFoundError) {
      return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 });
    }
    console.error('[context/jobs/cockpit GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
