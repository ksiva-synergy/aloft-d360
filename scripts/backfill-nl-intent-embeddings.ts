/**
 * backfill-nl-intent-embeddings.ts — Phase 3.5D one-time backfill.
 *
 * Since 3.5B/C, `nl_intent` has accumulated on authored definitions
 * (platform_sem_measures / platform_sem_dimensions) and on raw-SQL charts
 * (platform_charts) but was never embedded. Without this backfill, NL-intent
 * matching (empty-state prompts, disambiguation ranking) would ignore every
 * intent captured before 3.5D shipped.
 *
 * This embeds every not-yet-embedded nl_intent via the SAME Titan-v2 path the
 * context-builder uses (upsertIntentEmbedding → embedQuery), keyed by
 * (source_type, source_id) so re-runs are idempotent (ON CONFLICT upsert). Small
 * volume, safe to run against prod.
 *
 * Usage (repo root):
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     scripts/backfill-nl-intent-embeddings.ts
 */

import { prisma } from '@/lib/prisma';
import { upsertIntentEmbedding, type IntentSourceType } from '@/lib/semantic/intent-embed';

async function main() {
  const slug = process.env.DEFAULT_ORG_SLUG;
  const org = await prisma.platformOrg.findFirstOrThrow({ where: { slug } });
  console.log(`Backfilling NL-intent embeddings for org ${org.slug} (${org.id})`);

  // Which intents already have an embedding? (idempotency — skip work we've done)
  const existing = await prisma.$queryRaw<Array<{ source_type: string; source_id: string }>>`
    SELECT source_type, source_id FROM platform_nl_intent_embeddings WHERE org_id = ${org.id}
  `;
  const done = new Set(existing.map((e) => `${e.source_type}:${e.source_id}`));

  // Resolve each definition's model_id via its entity, so empty-state model
  // scoping works for backfilled rows too.
  const measures = await prisma.platform_sem_measures.findMany({
    where: { org_id: org.id, nl_intent: { not: null } },
    select: {
      id: true,
      nl_intent: true,
      created_by: true,
      platform_sem_entities: { select: { model_id: true } },
    },
  });
  const dimensions = await prisma.platform_sem_dimensions.findMany({
    where: { org_id: org.id, nl_intent: { not: null } },
    select: {
      id: true,
      nl_intent: true,
      created_by: true,
      platform_sem_entities: { select: { model_id: true } },
    },
  });
  const charts = await prisma.platform_charts.findMany({
    where: { org_id: org.id, nl_intent: { not: null }, deleted_at: null },
    select: { id: true, nl_intent: true, created_by: true },
  });

  const jobs: Array<{
    sourceType: IntentSourceType;
    sourceId: string;
    intentText: string;
    modelId: string | null;
    createdBy: string | null;
  }> = [
    ...measures.map((m) => ({
      sourceType: 'measure' as const,
      sourceId: m.id,
      intentText: m.nl_intent ?? '',
      modelId: m.platform_sem_entities?.model_id ?? null,
      createdBy: m.created_by,
    })),
    ...dimensions.map((d) => ({
      sourceType: 'dimension' as const,
      sourceId: d.id,
      intentText: d.nl_intent ?? '',
      modelId: d.platform_sem_entities?.model_id ?? null,
      createdBy: d.created_by,
    })),
    ...charts.map((c) => ({
      sourceType: 'raw_chart' as const,
      sourceId: c.id,
      intentText: c.nl_intent ?? '',
      modelId: null,
      createdBy: c.created_by === 'system' ? null : c.created_by,
    })),
  ];

  console.log(
    `Found ${jobs.length} captured intents ` +
      `(${measures.length} measures, ${dimensions.length} dimensions, ${charts.length} raw charts). ` +
      `${done.size} already embedded.`,
  );

  let embedded = 0;
  let skipped = 0;
  for (const job of jobs) {
    if (done.has(`${job.sourceType}:${job.sourceId}`)) {
      skipped++;
      continue;
    }
    if (!job.intentText.trim()) {
      skipped++;
      continue;
    }
    await upsertIntentEmbedding({
      orgId: org.id,
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      intentText: job.intentText,
      modelId: job.modelId,
      createdBy: job.createdBy,
    });
    if (++embedded % 25 === 0) console.log(`  …${embedded} embedded`);
  }

  const total = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM platform_nl_intent_embeddings WHERE org_id = ${org.id}
  `;
  console.log(
    `Done. embedded=${embedded} skipped=${skipped}. ` +
      `Total intent embeddings for org: ${Number(total[0]?.n ?? 0)}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
