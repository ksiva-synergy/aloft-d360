import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; measureId: string }> };

/**
 * One measure's full text, loaded when it is opened in Estate (the model payload carries only a DAX preview):
 *   GET …/models/:id/measures/:measureId → { dax, sql, tier, status, parity_verdict, translated_at }
 * `sql` is the Databricks SQL the translator produced (null when none yet).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const { id, measureId } = await ctx.params;
    const orgId = await getOrgId();
    const measure = await prisma.pbiMeasure.findFirst({
      where: { id: measureId, model_id: id, org_id: orgId },
      select: { id: true, dax: true },
    });
    if (!measure) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const tr = await prisma.pbiTranslation.findFirst({
      where: { org_id: orgId, model_id: id, measure_id: measure.id },
      select: { sql_text: true, tier: true, status: true, parity_verdict: true, updated_at: true },
    });

    return NextResponse.json({
      dax: measure.dax,
      sql: tr?.sql_text?.trim() ? tr.sql_text : null,
      tier: tr?.tier ?? null,
      status: tr?.status ?? null,
      parity_verdict: tr?.parity_verdict ?? null,
      translated_at: tr?.updated_at?.toISOString() ?? null,
    });
  } catch (err) {
    console.error('[api/powerbi/models/measures]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
