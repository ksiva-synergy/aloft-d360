import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { DatabricksAdapter } from '@/lib/context/databricks-adapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export interface ScanCoverageCatalog {
  catalog_name: string;
  databricks_count: number;
  aurora_count: number;
  missing: number;
  is_new: boolean;
  status: string;
}

export interface ScanCoverageResult {
  catalogs: ScanCoverageCatalog[];
  totals: { databricks: number; aurora: number; missing: number };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json();
  const { sourceId } = body as { sourceId?: string };

  if (!sourceId) {
    return NextResponse.json({ error: 'MISSING_SOURCE_ID' }, { status: 400 });
  }

  try {
    const orgId = await getOrgId();

    const source = await prisma.platformContextSource.findFirst({
      where: { id: sourceId, org_id: orgId },
    });
    if (!source) {
      return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 404 });
    }

    const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
      where: { id: source.connection_ref },
      select: { id: true, workspace_host: true, default_warehouse_id: true },
    });

    const adapter = new DatabricksAdapter(conn);

    // Aurora counts grouped by catalog
    const auroraRows = await prisma.$queryRawUnsafe<{ catalog_name: string; cnt: bigint }[]>(`
      SELECT catalog_name, COUNT(*) as cnt
      FROM platform_estate_objects
      WHERE org_id = $1
      GROUP BY catalog_name
    `, orgId);
    const auroraMap = new Map(auroraRows.map(r => [r.catalog_name, Number(r.cnt)]));

    // Discover catalogs visible to the token
    const catalogResult = await (adapter as any).exec('SHOW CATALOGS');
    const allCatalogs: string[] = (catalogResult.rows ?? [])
      .map((r: any) => r.catalog ?? r.catalog_name ?? Object.values(r)[0])
      .filter((c: string) => c && c !== 'information_schema' && c !== '__databricks_internal');

    // Determine which catalogs are already known in Aurora
    const knownCatalogs = new Set(auroraMap.keys());

    const catalogs: ScanCoverageCatalog[] = [];
    let totalDatabricks = 0;
    let totalAurora = 0;
    let totalMissing = 0;

    for (const catalog of allCatalogs) {
      let dbCount = 0;
      let status = '';
      try {
        const r = await (adapter as any).exec(
          `SELECT COUNT(*) as cnt FROM \`${catalog}\`.information_schema.tables WHERE table_schema != 'information_schema'`
        );
        dbCount = Number(r.rows[0]?.cnt ?? 0);
        const isNew = !knownCatalogs.has(catalog);
        status = isNew ? 'new' : 'ok';
      } catch (e: any) {
        const msg = e.message ?? '';
        if (msg.includes('INSUFFICIENT_PERMISSIONS')) status = 'no_permission';
        else if (msg.includes('does not exist') || msg.includes('NOT_FOUND')) status = 'not_found';
        else if (msg.includes('TCP') || msg.includes('timeout')) status = 'timeout';
        else status = 'error';
      }

      if (status === 'no_permission' || status === 'not_found') continue;

      const aurora = auroraMap.get(catalog) ?? 0;
      const missing = Math.max(0, dbCount - aurora);
      const isNew = !knownCatalogs.has(catalog);

      totalDatabricks += dbCount;
      totalAurora += aurora;
      totalMissing += missing;

      catalogs.push({
        catalog_name: catalog,
        databricks_count: dbCount,
        aurora_count: aurora,
        missing,
        is_new: isNew,
        status,
      });
    }

    // Sort: non-new first (descending by databricks count), then new ones
    catalogs.sort((a, b) => {
      if (a.is_new !== b.is_new) return a.is_new ? 1 : -1;
      return b.databricks_count - a.databricks_count;
    });

    const result: ScanCoverageResult = {
      catalogs,
      totals: { databricks: totalDatabricks, aurora: totalAurora, missing: totalMissing },
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[context/estate/scan-coverage POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
