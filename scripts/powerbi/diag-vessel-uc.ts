import { prisma } from '@/lib/prisma';
import {
  extractDaxTableNames,
  normalizePbiTableName,
  resolveUcForMeasure,
} from '@/lib/powerbi/translate-dax-refs';

const PBI_MODEL_ID = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

async function main() {
  const model = await prisma.pbiModel.findFirst({
    where: { pbi_model_id: PBI_MODEL_ID, lifecycle: 'active' },
    select: { id: true, org_id: true, name: true },
  });
  if (!model) {
    console.error('model not found for pbi_model_id', PBI_MODEL_ID);
    return;
  }
  console.log('internal model', model.id, model.name);

  const tables = await prisma.pbiTable.findMany({
    where: { org_id: model.org_id, model_id: model.id },
    select: {
      name: true,
      sourceBinding: { select: { bind_status: true, uc_full_path: true, native_sql: true } },
    },
  });
  const map = new Map<string, { uc: string; nativeSql: string | null }>();
  for (const t of tables) {
    const b = t.sourceBinding;
    if (b?.bind_status === 'matched' && b.uc_full_path?.trim()) {
      map.set(normalizePbiTableName(t.name), {
        uc: b.uc_full_path.trim(),
        nativeSql: b.native_sql ?? null,
      });
    }
  }

  const measures = await prisma.pbiMeasure.findMany({
    where: { org_id: model.org_id, model_id: model.id },
    select: { name: true, dax: true, table: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  console.log('bound:', [...map.keys()].join(', '));

  let ok = 0;
  let no = 0;
  for (const meas of measures) {
    const ht = meas.table.name;
    const hb = tables.find((t) => t.name === ht)?.sourceBinding;
    const homeUc =
      hb?.bind_status === 'matched' && hb.uc_full_path ? hb.uc_full_path : null;
    const dax = meas.dax ?? '';
    const r = resolveUcForMeasure({
      dax,
      homeTableName: ht,
      homeUc,
      homeNativeSql: hb?.native_sql ?? null,
      modelTables: map,
    });
    if (r) {
      ok += 1;
      console.log('OK', meas.name, r.via, r.sourceTable);
    } else {
      no += 1;
      const refs = extractDaxTableNames(dax);
      console.log('NO', meas.name, 'home=', ht, 'refs=', refs.slice(0, 8).join('|') || '(empty dax)');
    }
  }
  console.log({ resolved: ok, no_bind: no, bound_tables: map.size, measures: measures.length });
}

main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
