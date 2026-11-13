import 'server-only';

import prisma from '@/lib/db';

export type PowerBiObjectUsage = {
  model_id: string;
  model_name: string;
  pbi_model_id: string;
  table_name: string;
  bind_status: string;
};

export async function getPowerBiUsageForObject(
  orgId: string,
  contextObjectId: string,
): Promise<PowerBiObjectUsage[]> {
  const bindings = await prisma.pbiSourceBinding.findMany({
    where: {
      org_id: orgId,
      context_object_id: contextObjectId,
      bind_status: 'matched',
    },
    include: {
      model: { select: { id: true, name: true, pbi_model_id: true } },
      table: { select: { name: true } },
    },
  });

  return bindings.map((b) => ({
    model_id: b.model.id,
    model_name: b.model.name,
    pbi_model_id: b.model.pbi_model_id,
    table_name: b.table.name,
    bind_status: b.bind_status,
  }));
}
