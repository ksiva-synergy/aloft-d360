import { prisma } from '@/lib/prisma';
import {
  extractDaxTableNames,
  normalizePbiTableName,
  resolveUcForMeasure,
} from '@/lib/powerbi/translate-dax-refs';
import { tryRuleTierSql } from '@/lib/powerbi/translate-rule';

const PBI_MODEL_ID = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

async function main() {
  const model = await prisma.pbiModel.findFirst({
    where: { pbi_model_id: PBI_MODEL_ID, lifecycle: 'active' },
    select: { id: true, org_id: true, name: true },
  });
  if (!model) throw new Error('model not found');

  const tables = await prisma.pbiTable.findMany({
    where: { org_id: model.org_id, model_id: model.id },
    select: {
      id: true,
      name: true,
      sourceBinding: {
        select: {
          bind_status: true,
          uc_full_path: true,
          native_sql: true,
          databricks_source_id: true,
          connection_host: true,
        },
      },
    },
  });

  const ucMap = new Map<string, { uc: string; nativeSql: string | null }>();
  for (const t of tables) {
    const b = t.sourceBinding;
    if (b?.bind_status === 'matched' && b.uc_full_path?.trim()) {
      ucMap.set(normalizePbiTableName(t.name), {
        uc: b.uc_full_path.trim(),
        nativeSql: b.native_sql ?? null,
      });
    }
  }

  const measures = await prisma.pbiMeasure.findMany({
    where: { org_id: model.org_id, model_id: model.id },
    select: {
      id: true,
      name: true,
      dax: true,
      table: {
        select: {
          name: true,
          sourceBinding: { select: { databricks_source_id: true, bind_status: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const translations = await prisma.pbiTranslation.findMany({
    where: { org_id: model.org_id, model_id: model.id },
    select: {
      measure_id: true,
      measure_name: true,
      tier: true,
      parity_verdict: true,
      props: true,
      sql_text: true,
    },
  });
  const trByMeasure = new Map(translations.map((t) => [t.measure_id, t]));

  console.log('\n=== Translations & parity ===\n');
  for (const tr of translations) {
    const props = tr.props as Record<string, unknown>;
    const parity = props.parity as { summary?: string } | undefined;
    const homeDb = measures.find((m) => m.id === tr.measure_id)?.table.sourceBinding
      ?.databricks_source_id;
    console.log(
      [
        tr.measure_name,
        `tier=${tr.tier}`,
        `parity=${tr.parity_verdict ?? '-'}`,
        (parity?.summary ?? '').slice(0, 120),
        `uc_table=${props.uc_source_table ?? '?'}`,
      ].join(' | '),
    );
  }

  console.log('\n=== Missing translation (had UC) ===\n');
  for (const meas of measures) {
    const ht = meas.table.name;
    const hb = meas.table.sourceBinding;
    const homeUc =
      hb?.bind_status === 'matched' ? null : null; // home unbound for these
    const resolved = resolveUcForMeasure({
      dax: meas.dax ?? '',
      homeTableName: ht,
      homeUc: null,
      homeNativeSql: null,
      modelTables: ucMap,
    });
    if (!resolved) continue;
    if (trByMeasure.has(meas.id)) continue;

    const rule = tryRuleTierSql({
      dax: meas.dax ?? '',
      tableName: resolved.sourceTable,
      ucFullPath: resolved.uc,
    });
    const daxLen = (meas.dax ?? '').length;
    console.log(
      [
        meas.name,
        rule ? 'rule_should_work' : 'needs_llm',
        `dax_len=${daxLen}`,
        `refs=${extractDaxTableNames(meas.dax ?? '').slice(0, 4).join(',')}`,
      ].join(' | '),
    );
  }

  console.log('\n=== Measure-table binding (parity uses home table) ===\n');
  for (const t of ['Measure', 'Measure2']) {
    const row = tables.find((x) => normalizePbiTableName(x.name) === t);
    console.log(
      t,
      'databricks_source_id=',
      row?.sourceBinding?.databricks_source_id ?? 'null',
      'bind=',
      row?.sourceBinding?.bind_status ?? 'none',
    );
  }
  const via = tables.find(
    (x) => normalizePbiTableName(x.name) === 'Vessel Internal Audit',
  );
  console.log(
    'Vessel Internal Audit databricks_source_id=',
    via?.sourceBinding?.databricks_source_id ?? 'null',
    'connection_host=',
    (via?.sourceBinding as { connection_host?: string } | undefined)?.connection_host ?? 'n/a',
  );

  const bindings = await prisma.pbiSourceBinding.findMany({
    where: {
      org_id: model.org_id,
      partition_kind: 'warehouse_query',
      table: { is: { model_id: model.id, bind_status: 'matched' } },
    },
    select: {
      uc_full_path: true,
      connection_host: true,
      databricks_source_id: true,
      table: { select: { name: true } },
    },
  });
  console.log('\n=== Matched warehouse bindings ===\n', JSON.stringify(bindings, null, 2));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
