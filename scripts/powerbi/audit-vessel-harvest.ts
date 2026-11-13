#!/usr/bin/env npx tsx
/**
 * Compare TMDL on disk vs pbi_columns / measures for the Vessel model.
 */
import fs from 'node:fs';
import path from 'node:path';

import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import { getPbiRawStoreRoot } from '@/lib/powerbi/raw-store';
import { parseTmdlTableFile } from '@/lib/powerbi/tmdl-parse';
import { analyzeMeasureLogic, loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';

const VESSEL_MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

function walkTmdlTables(defDir: string): string[] {
  const tablesDir = path.join(defDir, 'definition', 'tables');
  if (!fs.existsSync(tablesDir)) return [];
  return fs
    .readdirSync(tablesDir)
    .filter((f) => f.endsWith('.tmdl'))
    .map((f) => path.join(tablesDir, f));
}

async function main() {
  const orgId = getDefaultOrg().id;
  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, pbi_model_id: VESSEL_MODEL, lifecycle: 'active' },
    select: { id: true, name: true, props: true },
  });
  if (!model) throw new Error('model not found');

  const defMeta = (model.props as Record<string, unknown>)?.definition as { storage_path?: string } | undefined;
  const absDir = path.join(getPbiRawStoreRoot(), defMeta?.storage_path ?? `definitions/${VESSEL_MODEL}`);

  const tmdlFiles = walkTmdlTables(absDir);
  const tableGaps: { table: string; tmdlCols: number; dbCols: number; missing: string[]; extra: string[] }[] = [];

  for (const file of tmdlFiles) {
    const parsed = parseTmdlTableFile(fs.readFileSync(file, 'utf8'));
    if (!parsed?.name) continue;
    const dbTable = await prisma.pbiTable.findFirst({
      where: { org_id: orgId, model_id: model.id, name: parsed.name },
      select: { id: true },
    });
    const dbCols = dbTable
      ? await prisma.pbiColumn.findMany({
          where: { org_id: orgId, table_id: dbTable.id },
          select: { name: true },
        })
      : [];
    const tmdlNames = new Set(parsed.columns.map((c) => c.name));
    const dbNames = new Set(dbCols.map((c) => c.name));
    const missing = [...tmdlNames].filter((n) => !dbNames.has(n));
    const extra = [...dbNames].filter((n) => !tmdlNames.has(n));
    if (missing.length || extra.length || !dbTable) {
      tableGaps.push({
        table: parsed.name,
        tmdlCols: tmdlNames.size,
        dbCols: dbNames.size,
        missing,
        extra,
      });
    }
  }

  console.log('=== TMDL vs DB column parity ===\n');
  if (tableGaps.length === 0) {
    console.log(`All ${tmdlFiles.length} TMDL tables match column names in DB.`);
  } else {
    for (const g of tableGaps) {
      console.log(`${g.table}: tmdl=${g.tmdlCols} db=${g.dbCols}`);
      if (g.missing.length) console.log('  missing in DB:', g.missing.join(', '));
      if (g.extra.length) console.log('  extra in DB:', g.extra.join(', '));
    }
  }

  const catalog = await loadMeasureLogicCatalog(orgId, model.id);
  const measures = await prisma.pbiMeasure.findMany({
    where: { org_id: orgId, model_id: model.id },
    select: { name: true, dax: true },
    orderBy: { name: 'asc' },
  });

  const harvestGaps: string[] = [];
  for (const m of measures) {
    const logic = analyzeMeasureLogic({ dax: m.dax, catalog, hasUc: true });
    if (logic.harvest_gap_refs.length) {
      harvestGaps.push(`${m.name}: ${logic.harvest_gap_refs.join(', ')}`);
    }
  }

  console.log('\n=== Measures with harvest_gap column refs ===\n');
  if (harvestGaps.length === 0) console.log('(none)');
  else harvestGaps.forEach((line) => console.log(line));

  let tmdlMeasureCount = 0;
  for (const file of tmdlFiles) {
    const parsed = parseTmdlTableFile(fs.readFileSync(file, 'utf8'));
    tmdlMeasureCount += parsed?.measures.length ?? 0;
  }
  console.log(`\n=== Measure counts: TMDL=${tmdlMeasureCount} DB=${measures.length} ===`);
  if (tmdlMeasureCount !== measures.length) {
    console.log('WARN: measure count mismatch — run force_parse or check skipped tables');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
