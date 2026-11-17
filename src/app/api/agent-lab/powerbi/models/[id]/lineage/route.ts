import { NextRequest, NextResponse } from 'next/server';

import { getOrgId } from '@/lib/databricks/connections';
import { buildModelHighLevelLineageForOrg } from '@/lib/powerbi/model-lineage-summary-build';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** High-level model lineage: reports → measures → semantic tables → UC (no per-step PQ graph). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const orgId = await getOrgId();
    const summary = await buildModelHighLevelLineageForOrg(orgId, id);
    if (!summary) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ summary });
  } catch (err) {
    console.error('[api/powerbi/models/lineage]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}