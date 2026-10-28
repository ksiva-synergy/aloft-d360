import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { computePipelineIntent, normalizePipelineScope } from '@/lib/estate/pipeline-intent';
import { LaunchSourceNotFoundError, resolveLaunchSources } from '@/lib/context/resolve-launch-source';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  sourceId: z.string().uuid().optional(),
  catalog: z.string().optional(),
  schema: z.string().optional(),
  includePatterns: z.string().optional(),
  through: z.enum(['t1_profile', 't2_semantic', 'embed']).optional(),
});

function parsePatterns(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  const includePatternsFromQuery = (() => {
    const all = req.nextUrl.searchParams.getAll('includePatterns');
    if (all.length > 0) {
      return all.flatMap(p => p.split(',').map(s => s.trim()).filter(Boolean));
    }
    return parsePatterns(parsed.data.includePatterns);
  })();

  try {
    const orgId = await getOrgId();
    const sources = await resolveLaunchSources(orgId, parsed.data.sourceId);
    const source = sources[0];
    if (!source) {
      return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 });
    }

    const includePatterns = includePatternsFromQuery;
    const scope = normalizePipelineScope({
      sourceId: source.id,
      catalog: parsed.data.catalog,
      schema: parsed.data.schema,
      includePatterns,
    });

    const intent = await computePipelineIntent(
      orgId,
      {
        sourceId: source.id,
        includePatterns: scope.includePatterns,
        catalog: parsed.data.catalog,
        schema: parsed.data.schema,
      },
      parsed.data.through ? { through: parsed.data.through } : undefined,
    );

    return NextResponse.json({ data: intent, sourceId: source.id });
  } catch (err) {
    if (err instanceof LaunchSourceNotFoundError) {
      return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 });
    }
    console.error('[context/pipeline/intent GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
