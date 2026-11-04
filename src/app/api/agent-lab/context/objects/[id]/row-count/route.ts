import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';
import { denyUnlessEstatePipelineOperator } from '@/lib/estate/require-estate-pipeline-operator';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agent-lab/context/objects/[id]/row-count
 *
 * Runs an exact COUNT(*) for one Delta table on its Databricks connection
 * (answered from Delta transaction-log statistics, not a scan), saves it as
 * row_count_est (and size_bytes_est when DESCRIBE DETAIL returns a size), and
 * returns { rows, format, countedAt }.
 *
 * 422 NOT_DELTA / NO_DETAIL — views and non-Delta tables are refused: the
 * same query would read the whole table.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const denied = await denyUnlessEstatePipelineOperator();
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'BAD_REQUEST', field: 'id' }, { status: 400 });

  try {
    const org = await getDefaultOrg();
    const object = await prisma.platformContextObject.findFirst({
      where: { id, org_id: org.id },
      select: { id: true, source_id: true, object_kind: true, catalog_name: true, schema_name: true, object_name: true },
    });
    if (!object) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (!object.catalog_name || !object.schema_name || !object.object_name) {
      return NextResponse.json({ error: 'BAD_OBJECT', message: 'Object has no catalog.schema.table path' }, { status: 422 });
    }
    if (object.object_kind === 'view') {
      return NextResponse.json({ error: 'NOT_DELTA', message: 'Views are not counted — COUNT(*) would run the whole view' }, { status: 422 });
    }

    const source = await prisma.platformContextSource.findFirst({
      where: { id: object.source_id, org_id: org.id },
      select: { connection_kind: true, connection_ref: true },
    });
    if (!source || source.connection_kind !== 'databricks') {
      return NextResponse.json({ error: 'UNSUPPORTED_SOURCE' }, { status: 422 });
    }
    const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
      where: { id: source.connection_ref },
      select: { id: true, workspace_host: true, default_warehouse_id: true },
    });

    const result = await new DatabricksAdapter(conn).countExactRows({
      catalog_name: object.catalog_name,
      schema_name: object.schema_name,
      object_name: object.object_name,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.reason,
          format: result.format,
          message: result.reason === 'NOT_DELTA'
            ? `Table format is ${result.format ?? 'unknown'} — exact count would need a full scan`
            : 'DESCRIBE DETAIL is not available for this object',
        },
        { status: 422 },
      );
    }

    await prisma.platformContextObject.update({
      where: { id: object.id },
      data: {
        row_count_est: BigInt(result.rows),
        ...(result.sizeBytes != null ? { size_bytes_est: BigInt(result.sizeBytes) } : {}),
      },
    });

    return NextResponse.json({
      data: { rows: result.rows, format: result.format, sizeBytes: result.sizeBytes, countedAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error('[context/objects/:id/row-count POST]', err);
    return NextResponse.json({ error: 'INTERNAL', message: err instanceof Error ? err.message : 'Count failed' }, { status: 500 });
  }
}
