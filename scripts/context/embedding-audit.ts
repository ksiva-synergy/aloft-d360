/**
 * Embedding + scanned-object coverage audit (read-only).
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/embedding-audit.ts
 */

import prisma from '@/lib/db';

const SOURCE_ID = process.env.ESTATE_SOURCE_ID ?? 'b491f1d6-944e-42d7-855b-dbd392bd7a3e';

async function main() {
  const source = await prisma.platformContextSource.findUnique({ where: { id: SOURCE_ID } });
  if (!source) {
    console.error('Source not found:', SOURCE_ID);
    process.exit(1);
  }
  const orgId = source.org_id;

  const embeddingsByKind = await prisma.$queryRawUnsafe<{ subject_kind: string; cnt: number }[]>(
    `SELECT subject_kind, COUNT(*)::int AS cnt
     FROM platform_context_embeddings WHERE org_id = $1
     GROUP BY subject_kind ORDER BY subject_kind`,
    orgId,
  );

  const contextStats = await prisma.$queryRawUnsafe<
    {
      context_objects: number;
      t0: number;
      t1: number;
      t2: number;
      with_object_embedding: number;
    }[]
  >(
    `SELECT
       COUNT(*)::int AS context_objects,
       COUNT(*) FILTER (WHERE last_t0_at IS NOT NULL)::int AS t0,
       COUNT(*) FILTER (WHERE last_t1_at IS NOT NULL)::int AS t1,
       COUNT(*) FILTER (WHERE last_t2_at IS NOT NULL)::int AS t2,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM platform_context_embeddings e
         WHERE e.org_id = o.org_id AND e.subject_id = o.id AND e.subject_kind = 'object'
       ))::int AS with_object_embedding
     FROM platform_context_objects o
     WHERE o.org_id = $1 AND o.source_id = $2::uuid AND o.lifecycle = 'active'`,
    orgId,
    SOURCE_ID,
  );

  const embeddingRowsTotal = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*)::int AS cnt FROM platform_context_embeddings WHERE org_id = $1`,
    orgId,
  );

  const estateLife = await prisma.$queryRawUnsafe<{ lifecycle: string; cnt: number }[]>(
    `SELECT lifecycle, COUNT(*)::int AS cnt
     FROM platform_estate_objects
     WHERE org_id = $1 AND source_id = $2
     GROUP BY lifecycle ORDER BY lifecycle`,
    orgId,
    SOURCE_ID,
  );

  const recentJobs = await prisma.platformContextJob.findMany({
    where: {
      org_id: orgId,
      source_id: SOURCE_ID,
      job_kind: { in: ['embed', 't2_semantic', 'estate_inventory', 't0_structural'] },
    },
    orderBy: { started_at: 'desc' },
    take: 12,
    select: { id: true, job_kind: true, status: true, started_at: true, stats: true },
  });

  const removedStillEmbedded = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(DISTINCT e.subject_id)::int AS cnt
     FROM platform_context_embeddings e
     INNER JOIN platform_context_objects o ON o.id = e.subject_id AND o.org_id = e.org_id
     WHERE e.org_id = $1 AND e.subject_kind = 'object' AND o.lifecycle != 'active'`,
    orgId,
  );

  console.log('=== Embedding audit ===');
  console.log('source:', source.display_name, SOURCE_ID);
  console.log('scope_include:', source.scope_include);
  console.log('\nplatform_context_embeddings rows (org):', embeddingRowsTotal[0]?.cnt ?? 0);
  console.log('by subject_kind:', embeddingsByKind);
  console.log('\nplatform_context_object (this source, active):', contextStats[0]);
  console.log('\nestate discovery lifecycle:', estateLife);
  console.log('\nembeddings on non-active context objects:', removedStillEmbedded[0]?.cnt ?? 0);
  const t2NoEmbed = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*)::int AS cnt
     FROM platform_context_objects o
     WHERE o.org_id = $1 AND o.source_id = $2::uuid AND o.lifecycle = 'active'
       AND o.last_t2_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM platform_context_embeddings e
         WHERE e.org_id = o.org_id AND e.subject_id = o.id AND e.subject_kind = 'object'
       )`,
    orgId,
    SOURCE_ID,
  );

  const embedByDay = await prisma.$queryRawUnsafe<{ d: Date; cnt: number }[]>(
    `SELECT date_trunc('day', created_at)::date AS d, COUNT(*)::int AS cnt
     FROM platform_context_embeddings
     WHERE org_id = $1
     GROUP BY 1
     ORDER BY d DESC
     LIMIT 14`,
    orgId,
  );

  const embedJobs = await prisma.platformContextJob.count({
    where: { org_id: orgId, source_id: SOURCE_ID, job_kind: 'embed', status: 'succeeded' },
  });

  console.log('\nT2-enriched objects missing object-level embedding:', t2NoEmbed[0]?.cnt ?? 0);
  console.log('Succeeded embed jobs (this source):', embedJobs);
  console.log('\nEmbedding row updates by day (last 14 days):');
  for (const row of embedByDay) console.log(row.d, row.cnt);

  console.log('\nRecent jobs (embed/t2/inventory/t0):');
  for (const j of recentJobs) {
    console.log(
      j.started_at?.toISOString().slice(0, 19),
      j.job_kind,
      j.status,
      JSON.stringify(j.stats),
    );
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
