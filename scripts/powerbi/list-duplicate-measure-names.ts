#!/usr/bin/env npx tsx
import prisma from '@/lib/db';

const MODEL = 'b7d7e779-15df-4c75-9c8a-27764fd889d2';

async function main() {
  const model = await prisma.pbiModel.findFirst({
    where: { pbi_model_id: MODEL },
    select: { id: true },
  });
  const measures = await prisma.pbiMeasure.findMany({
    where: { model_id: model!.id },
    select: { id: true, name: true, table: { select: { name: true } } },
  });
  const byName = new Map<string, typeof measures>();
  for (const m of measures) {
    if (!byName.has(m.name)) byName.set(m.name, []);
    byName.get(m.name)!.push(m);
  }
  for (const [name, list] of [...byName.entries()].filter(([, l]) => l.length > 1).sort()) {
    console.log(name, list.map((x) => `${x.id.slice(0, 8)}@${x.table.name}`).join(', '));
  }
}

main().finally(() => prisma.$disconnect());
