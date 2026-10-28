import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { runScheduledEstateHarvest } from '@/lib/context/scheduled-estate-harvest';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-lab/context/estate/run-scheduled
 *
 * Starts sequential T0→T1→T2→embed pipelines for schemas that have scheduled discovery rows.
 * Body: { sourceId?: string, catalog?: string, schema?: string, maxSchemas?: number }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // optional body
  }

  try {
    const orgId = await getOrgId();
    let sourceId = typeof body.sourceId === 'string' ? body.sourceId : undefined;

    if (!sourceId) {
      const first = await prisma.platformContextSource.findFirst({
        where: { org_id: orgId, status: 'active' },
        select: { id: true },
        orderBy: { created_at: 'asc' },
      });
      sourceId = first?.id;
    }

    if (!sourceId) {
      return NextResponse.json({ error: 'MISSING_SOURCE' }, { status: 400 });
    }

    const catalog = typeof body.catalog === 'string' ? body.catalog : undefined;
    const schema = typeof body.schema === 'string' ? body.schema : undefined;
    const maxSchemas = typeof body.maxSchemas === 'number' ? body.maxSchemas : undefined;

    const result = await runScheduledEstateHarvest({
      orgId,
      sourceId,
      catalog,
      schema,
      maxSchemas,
    });

    if (result.schemasStarted === 0) {
      return NextResponse.json(
        { ...result, message: 'No scheduled tables found for this scope' },
        { status: 200 },
      );
    }

    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    console.error('[context/estate/run-scheduled POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
