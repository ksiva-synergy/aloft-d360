/**
 * Call translate LLM for measures that still have no pbi_translation row (Vessel pilot).
 */
import { prisma } from '@/lib/prisma';
import { normalizePbiTableName, resolveUcForMeasure } from '@/lib/powerbi/translate-dax-refs';
import { tryRuleTierSql } from '@/lib/powerbi/translate-rule';
import { translateMeasureWithLlm } from '@/lib/powerbi/translate-llm';
import { extractJsonObject, validateLlmSql } from '@/lib/powerbi/translate-llm-validate';

const PBI_MODEL_ID = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';
const MAX = Number(process.env.PROBE_MAX ?? '3');

async function main() {
  const model = await prisma.pbiModel.findFirst({
    where: { pbi_model_id: PBI_MODEL_ID, lifecycle: 'active' },
    select: { id: true, org_id: true, name: true },
  });
  if (!model) throw new Error('model not found');

  const tables = await prisma.pbiTable.findMany({
    where: { org_id: model.org_id, model_id: model.id },
    select: { name: true, sourceBinding: { select: { bind_status: true, uc_full_path: true, native_sql: true } } },
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

  const existing = new Set(
    (
      await prisma.pbiTranslation.findMany({
        where: { org_id: model.org_id, model_id: model.id },
        select: { measure_id: true },
      })
    ).map((r) => r.measure_id),
  );

  const measures = await prisma.pbiMeasure.findMany({
    where: { org_id: model.org_id, model_id: model.id },
    include: { model: { select: { name: true } }, table: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  let probed = 0;
  for (const meas of measures) {
    if (existing.has(meas.id)) continue;
    const resolved = resolveUcForMeasure({
      dax: meas.dax ?? '',
      homeTableName: meas.table.name,
      homeUc: null,
      homeNativeSql: null,
      modelTables: ucMap,
    });
    if (!resolved) continue;
    if (tryRuleTierSql({ dax: meas.dax ?? '', tableName: resolved.sourceTable, ucFullPath: resolved.uc })) {
      continue;
    }
    if (probed >= MAX) break;
    probed += 1;
    console.log(`\n--- probe ${meas.name} ---`);
    const result = await translateMeasureWithLlm({
      modelName: meas.model.name,
      tableName: resolved.sourceTable,
      measureName: meas.name,
      dax: meas.dax ?? '',
      ucFullPath: resolved.uc,
      nativeSql: resolved.nativeSql,
    });
    if (result) {
      console.log('OK sql:', result.sql.slice(0, 120));
      continue;
    }
    console.log('FAILED (null) — re-fetch raw response not stored; check JSON/validate manually for this measure');
    const { harvestLlmComplete, getHarvestLlmModelId } = await import('@/lib/context/harvest-llm');
    const userMessage = JSON.stringify({
      model: meas.model.name,
      table: resolved.sourceTable,
      measure: meas.name,
      uc_full_path: resolved.uc,
      dax: (meas.dax ?? '').slice(0, 12000),
    });
    const resp = await harvestLlmComplete({
      system: 'Output strict JSON: {"sql":"...","assumptions":"..."}',
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2048,
      temperature: 0.1,
    });
    console.log('model:', getHarvestLlmModelId());
    console.log('raw:', resp.text.slice(0, 500));
    try {
      const json = JSON.parse(extractJsonObject(resp.text));
      const sql = validateLlmSql(String(json.sql ?? ''));
      console.log('parse ok, validateLlmSql:', sql ? 'pass' : 'reject', 'assumptions:', json.assumptions);
    } catch (e) {
      console.log('parse error:', e instanceof Error ? e.message : e);
    }
  }
}

main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
