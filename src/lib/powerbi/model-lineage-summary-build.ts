import prisma from '@/lib/db';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { buildModelHighLevelLineage, type ModelHighLevelLineage } from '@/lib/powerbi/model-lineage-summary';
import { reportConsumerFromRow } from '@/lib/powerbi/report-measure-refs';

export async function buildModelHighLevelLineageForOrg(
  orgId: string,
  modelId: string,
): Promise<ModelHighLevelLineage | null> {
  const model = await prisma.pbiModel.findFirst({
    where: { id: modelId, org_id: orgId, lifecycle: 'active' },
    select: { id: true, name: true },
  });
  if (!model) return null;

  const [catalog, reportRows] = await Promise.all([
    loadMeasureLogicCatalog(orgId, model.id),
    prisma.pbiReport.findMany({
      where: { org_id: orgId, model_id: model.id, lifecycle: 'active' },
      select: { id: true, name: true, props: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const reportConsumers = reportRows.map((r) => reportConsumerFromRow(r));
  return buildModelHighLevelLineage({
    modelId: model.id,
    modelName: model.name,
    catalog,
    reportConsumers,
  });
}