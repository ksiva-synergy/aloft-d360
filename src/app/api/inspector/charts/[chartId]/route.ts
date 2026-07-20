import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/charts/[chartId]
 * Returns a single non-deleted saved chart in the default org, or 404.
 * Used by the Phase 2 "View source" provenance link (widget → source chart)
 * and to resolve source-chart availability. A soft-deleted or missing chart is
 * a plain 404 — a dangling source_chart_id is expected, not an error.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chartId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { chartId } = await params;

    const chart = await prisma.platform_charts.findFirst({
      where: { id: chartId, org_id: org.id, deleted_at: null },
    });

    if (!chart) {
      return NextResponse.json({ error: 'Chart not found' }, { status: 404 });
    }

    return NextResponse.json({ chart });
  } catch (err) {
    console.error('[charts GET by id]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

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
