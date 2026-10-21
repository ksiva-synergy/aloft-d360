/**
 * Audit platform_estate_objects after a partial inventory sweep.
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/estate-db-audit.ts
 */

import prisma from '@/lib/db';

const SOURCE_ID = 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';

async function main() {
  const source = await prisma.platformContextSource.findUnique({
    where: { id: SOURCE_ID },
  });
  if (!source) {
    console.error('Source not found');
    process.exit(1);
  }
  const orgId = source.org_id;
  console.log('=== Source ===');
  console.log(source.display_name, source.id);
  console.log('scope_include:', source.scope_include);
  console.log('scope_exclude:', Array.isArray(source.scope_exclude) ? (source.scope_exclude as string[]).length : 0, 'patterns');

  const byLife = await prisma.$queryRawUnsafe<
    { lifecycle: string; cnt: bigint }[]
  >(
    `SELECT lifecycle, COUNT(*)::bigint AS cnt
     FROM platform_estate_objects
     WHERE org_id = $1 AND source_id = $2
     GROUP BY lifecycle ORDER BY lifecycle`,
    orgId,
    SOURCE_ID,
  );
  console.log('\n=== By lifecycle (this source) ===');
  for (const r of byLife) console.log(r.lifecycle, Number(r.cnt));

  const activeCats = await prisma.$queryRawUnsafe<
    { catalog_name: string; cnt: bigint }[]
  >(
    `SELECT catalog_name, COUNT(*)::bigint AS cnt
     FROM platform_estate_objects
     WHERE org_id = $1 AND source_id = $2 AND lifecycle = 'active'
     GROUP BY catalog_name
     ORDER BY cnt DESC
     LIMIT 15`,
    orgId,
    SOURCE_ID,
  );
  console.log('\n=== Top active catalogs (this source) ===');
  for (const r of activeCats) console.log(r.catalog_name, Number(r.cnt));

  const removedCats = await prisma.$queryRawUnsafe<
    { catalog_name: string; cnt: bigint }[]
  >(
    `SELECT catalog_name, COUNT(*)::bigint AS cnt
     FROM platform_estate_objects
     WHERE org_id = $1 AND source_id = $2 AND lifecycle = 'removed'
     GROUP BY catalog_name
     ORDER BY cnt DESC
     LIMIT 15`,
    orgId,
    SOURCE_ID,
  );
  console.log('\n=== Top REMOVED catalogs (this source) ===');
  if (removedCats.length === 0) console.log('(none)');
  for (const r of removedCats) console.log(r.catalog_name, Number(r.cnt));

  const recentJobs = await prisma.platformContextJob.findMany({
    where: { org_id: orgId, source_id: SOURCE_ID, job_kind: 'estate_inventory' },
    orderBy: { started_at: 'desc' },
    take: 5,
    select: { id: true, status: true, started_at: true, stats: true, trigger: true },
  });
  console.log('\n=== Last 5 estate_inventory jobs ===');
  for (const j of recentJobs) {
    console.log(j.started_at?.toISOString(), j.status, j.trigger, JSON.stringify(j.stats));
  }

  const oazOnly = await prisma.$queryRawUnsafe<{ active: bigint; removed: bigint }[]>(
    `SELECT
       COUNT(*) FILTER (WHERE lifecycle = 'active' AND catalog_name = 'open_analytics_zone') AS active,
       COUNT(*) FILTER (WHERE lifecycle = 'removed') AS removed
     FROM platform_estate_objects
     WHERE org_id = $1 AND source_id = $2`,
    orgId,
    SOURCE_ID,
  );
  console.log('\n=== open_analytics_zone active vs total removed ===');
  console.log(oazOnly[0]);

  // Org-wide: other sources?
  const otherSources = await prisma.$queryRawUnsafe<
    { source_id: string | null; lifecycle: string; cnt: bigint }[]
  >(
    `SELECT source_id, lifecycle, COUNT(*)::bigint AS cnt
     FROM platform_estate_objects
     WHERE org_id = $1
     GROUP BY source_id, lifecycle
     ORDER BY cnt DESC`,
    orgId,
  );
  console.log('\n=== All estate rows by source_id + lifecycle ===');
  for (const r of otherSources) {
    console.log(r.source_id ?? 'NULL', r.lifecycle, Number(r.cnt));
  }

  const orgActive = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    `SELECT COUNT(*)::bigint AS cnt FROM platform_estate_objects WHERE org_id = $1 AND lifecycle = 'active'`,
    orgId,
  );
  const nullSource = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    `SELECT COUNT(*)::bigint AS cnt FROM platform_estate_objects WHERE org_id = $1 AND lifecycle = 'active' AND source_id IS NULL`,
    orgId,
  );
  console.log('\n=== Org active total ===', Number(orgActive[0]?.cnt ?? 0));
  console.log('=== Active with NULL source_id ===', Number(nullSource[0]?.cnt ?? 0));

  // Simulate facets API (org-wide, no test filter)
  const facetCats = await prisma.$queryRawUnsafe<{ name: string; count: number }[]>(
    `SELECT catalog_name AS name, COUNT(*)::int AS count
     FROM platform_estate_objects WHERE org_id = $1 AND lifecycle = 'active'
     GROUP BY catalog_name ORDER BY count DESC`,
    orgId,
  );
  const facetTotal = facetCats.reduce((s, c) => s + c.count, 0);
  console.log('\n=== Facets-equivalent: catalogs ===', facetCats.length, 'objects', facetTotal);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
