import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/inspector/charts/[chartId]
 * Soft-deletes a saved chart (sets deleted_at = now()).
 * Org-scoped — cannot delete charts belonging to another org.
 * Consistent with D1's platform_dashboards soft-delete pattern.
 */

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ chartId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { chartId } = await params;

    const existing = await prisma.platform_charts.findFirst({
      where: { id: chartId, org_id: org.id, deleted_at: null },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Chart not found' }, { status: 404 });
    }

    await prisma.platform_charts.update({
      where: { id: chartId },
      data: { deleted_at: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[charts DELETE]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
