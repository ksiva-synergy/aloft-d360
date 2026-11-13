import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOrgId } from '@/lib/databricks/connections';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(req, ['estate.powerbi', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const workspaces = await prisma.pbiWorkspace.findMany({
      where: { org_id: orgId, lifecycle: 'active' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        pbi_workspace_id: true,
        name: true,
        domain_hint: true,
        updated_at: true,
        _count: { select: { models: true, reports: true } },
      },
    });

    return NextResponse.json({
      workspaces: workspaces.map((w) => ({
        id: w.id,
        pbi_workspace_id: w.pbi_workspace_id,
        name: w.name ?? w.pbi_workspace_id,
        domain_hint: w.domain_hint,
        model_count: w._count.models,
        report_count: w._count.reports,
        updated_at: w.updated_at.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[powerbi/workspaces GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
