import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { fetchModelOwnership, type PbiOwnership } from '@/lib/powerbi/pbi-ownership';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Cached on pbi_models.props.ownership; refetched when older than this or with ?refresh=1. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Ownership, access, refresh and source facts for a model (Estate → Power BI → model). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const orgId = await getOrgId();
    const model = await prisma.pbiModel.findFirst({
      where: { id, org_id: orgId, lifecycle: 'active' },
      select: { id: true, pbi_model_id: true, props: true, workspace: { select: { pbi_workspace_id: true } } },
    });
    if (!model) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const cached = ((model.props ?? {}) as Record<string, unknown>).ownership as PbiOwnership | undefined;
    const fresh = cached?.fetched_at && Date.now() - Date.parse(cached.fetched_at) < MAX_AGE_MS;
    if (cached && fresh && req.nextUrl.searchParams.get('refresh') !== '1') {
      return NextResponse.json({ ownership: cached, cached: true });
    }

    const ownership = await fetchModelOwnership(model.workspace.pbi_workspace_id, model.pbi_model_id);
    await prisma.$executeRaw`UPDATE pbi_models
      SET props = COALESCE(props, '{}'::jsonb) || jsonb_build_object('ownership', ${JSON.stringify(ownership)}::jsonb)
      WHERE id = ${model.id}::uuid`;
    return NextResponse.json({ ownership, cached: false });
  } catch (err) {
    console.error('[api/powerbi/models/ownership]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
