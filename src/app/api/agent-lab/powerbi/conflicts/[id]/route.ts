import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const ALLOWED_STATUS = new Set(['proposed', 'acknowledged', 'deferred', 'resolved']);

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'manage']);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const orgId = await getOrgId();
    const body = (await req.json()) as { status?: string; note?: string };

    if (!body.status || !ALLOWED_STATUS.has(body.status)) {
      return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
    }

    const existing = await prisma.pbiConflict.findFirst({
      where: { id, org_id: orgId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const props = {
      ...(existing.props as Record<string, unknown>),
      ...(body.note ? { steward_note: body.note, steward_updated_at: new Date().toISOString() } : {}),
    };

    const row = await prisma.pbiConflict.update({
      where: { id },
      data: {
        status: body.status,
        props: props as object,
        updated_at: new Date(),
      },
    });

    return NextResponse.json({
      conflict: {
        id: row.id,
        status: row.status,
        metric_name: row.metric_name,
      },
    });
  } catch (err) {
    console.error('[powerbi/conflicts/[id] PATCH]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
