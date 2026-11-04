import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessSessionRole } from '@/middleware/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { fetchCostSummary } from '@/lib/spend/cost-queries';
import { getBudgetStatuses } from '@/lib/spend/budgets';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await denyUnlessSessionRole('admin');
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const daysRaw = req.nextUrl.searchParams.get('days');
    const days = Math.min(90, Math.max(1, parseInt(daysRaw ?? '30', 10) || 30));
    const summary = await fetchCostSummary(orgId, days);
    const budgets = await getBudgetStatuses(orgId);
    return NextResponse.json({ ...summary, budgets });
  } catch (err) {
    console.error('[admin/cost/summary]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load cost summary' },
      { status: 500 },
    );
  }
}
