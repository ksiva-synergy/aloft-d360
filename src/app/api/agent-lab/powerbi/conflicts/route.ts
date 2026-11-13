import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

function modelIdsFromJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const status = req.nextUrl.searchParams.get('status')?.trim() || 'proposed';

    const conflicts = await prisma.pbiConflict.findMany({
      where: { org_id: orgId, status },
      orderBy: { metric_name: 'asc' },
      take: 200,
    });

    const allModelIds = new Set<string>();
    for (const c of conflicts) {
      for (const id of modelIdsFromJson(c.model_ids)) allModelIds.add(id);
    }

    const modelRows =
      allModelIds.size > 0
        ? await prisma.pbiModel.findMany({
            where: { org_id: orgId, id: { in: [...allModelIds] } },
            select: { id: true, name: true, pbi_model_id: true },
          })
        : [];
    const modelById = new Map(modelRows.map((m) => [m.id, m]));

    return NextResponse.json({
      conflicts: conflicts.map((c) => {
        const ids = modelIdsFromJson(c.model_ids);
        return {
          id: c.id,
          metric_name: c.metric_name,
          metric_key: c.metric_key,
          status: c.status,
          summary: c.summary,
          domain_keys: c.domain_keys,
          dax_hashes: c.dax_hashes,
          models: ids.map((id) => {
            const m = modelById.get(id);
            return { id, name: m?.name ?? null, pbi_model_id: m?.pbi_model_id ?? null };
          }),
        };
      }),
    });
  } catch (err) {
    console.error('[powerbi/conflicts GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
