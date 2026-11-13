/**
 * Print recreation summary + failure reasons for Vessel Internal Audit model.
 */
import { prisma } from '@/lib/prisma';
import { buildModelRecreationSummary } from '@/lib/powerbi/recreation-summary';

const PBI_MODEL_ID = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

async function main() {
  const model = await prisma.pbiModel.findFirst({
    where: { pbi_model_id: PBI_MODEL_ID, lifecycle: 'active' },
    select: { id: true, org_id: true, name: true },
  });
  if (!model) throw new Error('model not found');

  const { summary, measures } = await buildModelRecreationSummary(model.org_id, model.id);
  console.log(model.name, summary);
  console.log('\n=== Failures / not recreated ===\n');
  for (const f of summary.failures) {
    console.log(`${f.measure_name} | ${f.stage} | ${f.reason.slice(0, 140)}`);
  }
  console.log('\n=== Published / recreated ===\n');
  for (const m of measures.filter((r) => r.stage === 'published' || r.stage === 'recreated')) {
    console.log(`${m.measure_name} | ${m.stage} | tier=${m.translation_tier} | ${m.reason ?? ''}`);
  }
}

main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
