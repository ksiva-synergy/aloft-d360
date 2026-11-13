import { prisma } from '@/lib/prisma';
import { pickDatabricksSourceId } from '@/lib/powerbi/native-sql';

const HOST = 'adb-4626041107022307.7.azuredatabricks.net';

async function main() {
  const model = await prisma.pbiModel.findFirst({
    where: { pbi_model_id: 'b7d7e779-15df-4c75-9c8a-27764fd889d2' },
    select: { org_id: true },
  });
  if (!model) return;
  const sources = await prisma.platformContextSource.findMany({
    where: { org_id: model.org_id, connection_kind: 'databricks', status: 'active' },
    select: { id: true, display_name: true, connection_ref: true },
  });
  console.log('databricks sources:', sources);
  console.log('pick for host:', HOST, '=>', pickDatabricksSourceId(HOST, sources));
}

main().finally(() => prisma.$disconnect());
