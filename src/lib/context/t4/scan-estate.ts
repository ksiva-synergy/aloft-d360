import 'server-only';
import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import { filterT4EligibleByScope, type T4EligibleObject } from './cluster';

export type { T4EligibleObject, T4SchemaCluster } from './cluster';
export { filterT4EligibleByScope, groupObjectsBySchemaCluster } from './cluster';

/** Objects with T2 complete and T4 stale or missing, optionally inside a job Limit. */
export async function scanEstateForT4(
  orgId: string,
  sourceId?: string | null,
  scope?: { includePatterns?: string[]; excludeSchemas?: string[] },
): Promise<T4EligibleObject[]> {
  const srcClause = sourceId ? Prisma.sql`AND o.source_id = ${sourceId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<T4EligibleObject[]>(Prisma.sql`
    SELECT
      o.id,
      o.source_id::text AS source_id,
      o.full_path,
      o.catalog_name,
      o.schema_name,
      o.object_name
    FROM platform_context_objects o
    WHERE o.org_id = ${orgId}
      AND o.lifecycle = 'active'
      AND o.last_t2_at IS NOT NULL
      AND (o.last_t4_at IS NULL OR o.last_t4_at < o.last_t2_at)
      ${srcClause}
    ORDER BY o.full_path
  `);
  return filterT4EligibleByScope(rows, scope);
}
