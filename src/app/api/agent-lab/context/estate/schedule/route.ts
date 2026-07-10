import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-lab/context/estate/schedule
 *
 * Toggle harvest schedule inclusion at table, schema, or catalog level.
 * Body: { action: 'include' | 'exclude', scope: { paths?: string[], schemas?: string[], catalogs?: string[] } }
 *
 * - include: sets harvest_state = 'scheduled' on matching active estate rows
 * - exclude: clears harvest_state to NULL on matching active estate rows (unless already queued/harvested)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json();
  const action: string = body.action;
  const scope = body.scope as { paths?: string[]; schemas?: string[]; catalogs?: string[] } | undefined;

  if (!action || !['include', 'exclude'].includes(action)) {
    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 });
  }
  if (!scope || (!scope.paths?.length && !scope.schemas?.length && !scope.catalogs?.length)) {
    return NextResponse.json({ error: 'MISSING_SCOPE' }, { status: 400 });
  }

  try {
    const orgId = await getOrgId();
    let affected = 0;

    if (action === 'include') {
      // Mark rows as scheduled (only if not already queued/harvested/inaccessible)
      if (scope.paths?.length) {
        const r = await prisma.$executeRawUnsafe(
          `UPDATE platform_estate_objects
           SET harvest_state = 'scheduled'
           WHERE org_id = $1 AND lifecycle = 'active'
             AND full_path = ANY($2::text[])
             AND (harvest_state IS NULL OR harvest_state NOT IN ('queued', 'harvested', 'inaccessible', 'scheduled'))`,
          orgId, scope.paths,
        );
        affected += r;
      }
      if (scope.schemas?.length) {
        for (const schemaPath of scope.schemas) {
          const [catalog, schema] = schemaPath.split('.');
          if (!catalog || !schema) continue;
          const r = await prisma.$executeRawUnsafe(
            `UPDATE platform_estate_objects
             SET harvest_state = 'scheduled'
             WHERE org_id = $1 AND lifecycle = 'active'
               AND catalog_name = $2 AND schema_name = $3
               AND (harvest_state IS NULL OR harvest_state NOT IN ('queued', 'harvested', 'inaccessible', 'scheduled'))`,
            orgId, catalog, schema,
          );
          affected += r;
        }
      }
      if (scope.catalogs?.length) {
        const r = await prisma.$executeRawUnsafe(
          `UPDATE platform_estate_objects
           SET harvest_state = 'scheduled'
           WHERE org_id = $1 AND lifecycle = 'active'
             AND catalog_name = ANY($2::text[])
             AND (harvest_state IS NULL OR harvest_state NOT IN ('queued', 'harvested', 'inaccessible', 'scheduled'))`,
          orgId, scope.catalogs,
        );
        affected += r;
      }
    } else {
      // Exclude: clear scheduled state back to NULL (never touch queued/harvested)
      if (scope.paths?.length) {
        const r = await prisma.$executeRawUnsafe(
          `UPDATE platform_estate_objects
           SET harvest_state = NULL
           WHERE org_id = $1 AND lifecycle = 'active'
             AND full_path = ANY($2::text[])
             AND harvest_state = 'scheduled'`,
          orgId, scope.paths,
        );
        affected += r;
      }
      if (scope.schemas?.length) {
        for (const schemaPath of scope.schemas) {
          const [catalog, schema] = schemaPath.split('.');
          if (!catalog || !schema) continue;
          const r = await prisma.$executeRawUnsafe(
            `UPDATE platform_estate_objects
             SET harvest_state = NULL
             WHERE org_id = $1 AND lifecycle = 'active'
               AND catalog_name = $2 AND schema_name = $3
               AND harvest_state = 'scheduled'`,
            orgId, catalog, schema,
          );
          affected += r;
        }
      }
      if (scope.catalogs?.length) {
        const r = await prisma.$executeRawUnsafe(
          `UPDATE platform_estate_objects
           SET harvest_state = NULL
           WHERE org_id = $1 AND lifecycle = 'active'
             AND catalog_name = ANY($2::text[])
             AND harvest_state = 'scheduled'`,
          orgId, scope.catalogs,
        );
        affected += r;
      }
    }

    return NextResponse.json({ action, affected });
  } catch (err) {
    console.error('[context/estate/schedule POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
