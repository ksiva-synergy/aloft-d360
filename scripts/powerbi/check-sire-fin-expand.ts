#!/usr/bin/env npx tsx
import prisma from '@/lib/db';

const MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

async function main() {
  const model = await prisma.pbiModel.findFirst({
    where: { pbi_model_id: MODEL, lifecycle: 'active' },
    select: { id: true },
  });
  const rows = await prisma.pbiTranslation.findMany({
    where: {
      model_id: model!.id,
      measure_name: { in: ['SIRE_Fin', 'PSC_Det', 'PSC_Fin'] },
    },
    select: { measure_name: true, tier: true, sql_text: true, props: true },
  });
  for (const r of rows) {
    const props = r.props as Record<string, unknown>;
    console.log(
      r.measure_name,
      'tier=',
      r.tier,
      'pattern=',
      props.pattern,
      'sql_len=',
      r.sql_text?.length ?? 0,
    );
    if (r.sql_text) console.log(r.sql_text.slice(0, 200), '...');
  }
}

main().finally(() => prisma.$disconnect());
