import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { denyUnlessSection } from '@/lib/sections/server';
import { buildSourceImpact, buildSourceTree, nodeIdForKey, type ImpactRow } from '@/lib/powerbi/source-impact';

export const dynamic = 'force-dynamic';

/**
 * Reverse lineage from stored report snapshots.
 *   GET           → the source tree: system → server/site → database/folder → schema → table/file, with counts
 *   GET ?node=    → also everything that depends on that node (any level of the tree)
 *   GET ?key=     → the same for one original source key (links from a report's lineage page)
 * Read-only; uses the latest Catalog link snapshot per report.
 */
export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const rows = await prisma.$queryRaw<ImpactRow[]>`
      SELECT l.report_id::text AS report_id,
             r.name AS report_name,
             l.status,
             l.model_id::text AS model_id,
             m.name AS model_name,
             s->>'table' AS "table",
             s->'referenced_by_measures' AS refs,
             o AS origin
      FROM pbi_report_lineage l
      JOIN pbi_reports r ON r.id = l.report_id AND r.org_id = l.org_id
      LEFT JOIN pbi_models m ON m.id = l.model_id AND m.org_id = l.org_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.lineage->'sources') = 'array' THEN l.lineage->'sources' ELSE '[]'::jsonb END) s
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s->'origins') = 'array' THEN s->'origins' ELSE '[]'::jsonb END) o
      WHERE l.org_id = ${orgId}
        AND r.lifecycle = 'active'
        AND o->>'system' NOT IN ('unknown', 'calculated', 'embedded')`;

    const key = req.nextUrl.searchParams.get('key');
    const requested = req.nextUrl.searchParams.get('node');
    const node = requested ?? (key ? nodeIdForKey(rows, key) : null);
    const tree = buildSourceTree(rows);
    const impact = node ? buildSourceImpact(rows, node) : null;
    return NextResponse.json({
      tree,
      total_sources: tree.filter((n) => n.depth === 0).reduce((sum, n) => sum + n.sources, 0),
      node: impact ? node : null,
      impact,
      not_found: Boolean((requested || key) && !impact),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/pbi_report_lineage/.test(message) && /does not exist/.test(message)) {
      return NextResponse.json({ error: 'LINEAGE_STORAGE_NOT_READY', message: 'Report lineage snapshots are not set up yet.' }, { status: 503 });
    }
    console.error('[api/powerbi/sources/impact]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
