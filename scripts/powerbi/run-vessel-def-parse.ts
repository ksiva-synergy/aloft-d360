#!/usr/bin/env npx tsx
/** Re-fetch TMDL definitions + parse for Vessel Internal Audit only. */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';
import { getDefaultOrg } from '@/lib/org';
import { getPbiRawStoreRoot } from '@/lib/powerbi/raw-store';

const VESSEL_REPORT = '093a04a2-aff1-4acb-8e80-2906cd4605a3';
const VESSEL_MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

const WANT = [
  'PSC_Check_Det',
  'PSC_Check_Find',
  'Audit_Duration',
  'Report_Duration',
  'port',
  'Updt_TOD',
  'SIRE_Check',
] as const;

async function main() {
  const orgId = getDefaultOrg().id;
  const source = await prisma.platformContextSource.findFirst({
    where: { org_id: orgId, connection_kind: 'powerbi', status: 'active' },
    select: { id: true, display_name: true },
  });
  if (!source) throw new Error('No active powerbi source');

  const scope = {
    report_ids: [VESSEL_REPORT],
    model_ids: [VESSEL_MODEL],
    fetch_models: true,
    fetch_reports: false,
    max_models: 1,
    max_reports: 1,
    pilot: true,
  };

  const { runQueuedJobById } = await import('../context/orchestrator');

  for (const kind of ['pbi_definitions', 'pbi_parse', 'pbi_catalog_link'] as const) {
    const jobScope =
      kind === 'pbi_parse' ? { ...scope, force_parse: true as const } : scope;
    const job = await enqueue(kind, source.id, jobScope, 'on_demand', orgId);
    console.log(`[vessel] ${kind} job=${job.id}`);
    const result = await runQueuedJobById(orgId, job.id);
    if (result.status === 'failed') throw new Error(result.error ?? `${kind} failed`);
    console.log(`[vessel] ${kind} ok`, result.stats ?? '');
  }

  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, pbi_model_id: VESSEL_MODEL, lifecycle: 'active' },
    select: { id: true, props: true },
  });
  if (!model) throw new Error('model not found');

  const defPath = path.join(
    getPbiRawStoreRoot(),
    'definitions',
    VESSEL_MODEL,
  );
  let tmdlPscHits = 0;
  if (existsSync(defPath)) {
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name.endsWith('.tmdl')) {
          const t = readFileSync(p, 'utf8');
          if (t.includes('PSC_Check_Det')) tmdlPscHits += 1;
        }
      }
    };
    walk(defPath);
    console.log(`[vessel] TMDL files mentioning PSC_Check_Det: ${tmdlPscHits}`);
  } else {
    console.log(`[vessel] no local definition store at ${defPath}`);
  }

  const viaTable = await prisma.pbiTable.findFirst({
    where: { org_id: orgId, model_id: model.id, name: { contains: 'Vessel Internal' } },
    select: { id: true, name: true, _count: { select: { columns: true } } },
  });

  const cols = await prisma.pbiColumn.findMany({
    where: { org_id: orgId, model_id: model.id, table_id: viaTable?.id },
    select: { name: true, source_column: true, calculated_dax: true },
    orderBy: { name: 'asc' },
  });

  console.log('\n=== Vessel Internal Audit columns after parse ===');
  console.log('count:', cols.length);
  for (const w of WANT) {
    const hit = cols.find((c) => c.name === w);
    console.log(
      w,
      hit
        ? hit.calculated_dax
          ? 'calculated'
          : hit.source_column
            ? `warehouse(${hit.source_column})`
            : 'imported'
        : 'MISSING',
    );
  }

  const defMeta = (model.props as Record<string, unknown>)?.definition as Record<string, unknown> | undefined;
  console.log('\ndefinition fetched_at:', defMeta?.fetched_at);
  console.log('part_count:', defMeta?.part_count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
