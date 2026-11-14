#!/usr/bin/env npx tsx
/**
 * Force re-parse (pbi_parse) + catalog link for every active model that already has a
 * harvested definition — applies TMDL parser fixes estate-wide without re-downloading.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/run-reparse-harvested.ts
 */
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/org';

async function main() {
  const orgId = getDefaultOrg().id;
  const source = await prisma.platformContextSource.findFirst({
    where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' },
    select: { id: true },
  });
  if (!source) throw new Error('No active powerbi source');

  const models = await prisma.pbiModel.findMany({
    where: { org_id: orgId, lifecycle: 'active' },
    select: { pbi_model_id: true, name: true, props: true },
  });
  const harvested = models.filter((m) => {
    const def = (m.props as Record<string, unknown>)?.definition as Record<string, unknown> | undefined;
    return Boolean(def?.storage_path && def?.content_hash);
  });
  const ids = harvested.map((m) => m.pbi_model_id);
  console.log(`[reparse] ${ids.length} harvested models:`, harvested.map((m) => m.name).join(', '));
  if (!ids.length) return;

  const scope = { model_ids: ids, max_models: ids.length, pilot: false, force_parse: true };
  const { runQueuedJobById } = await import('../context/orchestrator');
  for (const kind of ['pbi_parse', 'pbi_catalog_link'] as const) {
    const job = await enqueue(kind, source.id, scope, 'on_demand', orgId);
    const result = await runQueuedJobById(orgId, job.id);
    console.log(`[reparse] ${kind} ${result.status}`, result.error ?? '');
    if (result.status === 'failed') throw new Error(result.error ?? `${kind} failed`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
