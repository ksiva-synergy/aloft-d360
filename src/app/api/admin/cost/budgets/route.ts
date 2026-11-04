import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessSessionRole } from '@/middleware/auth';
import { getOrgId } from '@/lib/databricks/connections';
import {
  getBudgetStatuses,
  listBudgetPolicies,
  upsertBudgetPolicy,
  type BudgetMode,
  type BudgetPeriod,
} from '@/lib/spend/budgets';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await denyUnlessSessionRole('admin');
  if (denied) return denied;
  try {
    const orgId = await getOrgId();
    const [policies, statuses] = await Promise.all([
      listBudgetPolicies(orgId),
      getBudgetStatuses(orgId),
    ]);
    return NextResponse.json({ policies, statuses });
  } catch (err) {
    console.error('[admin/cost/budgets GET]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const denied = await denyUnlessSessionRole('admin');
  if (denied) return denied;
  try {
    const orgId = await getOrgId();
    const body = (await req.json()) as {
      id?: string;
      scope: string;
      amountUsd: number;
      period?: BudgetPeriod;
      mode?: BudgetMode;
      alertPct?: number;
      alertEmail?: string | null;
    };
    if (!body.scope || typeof body.amountUsd !== 'number') {
      return NextResponse.json({ error: 'scope and amountUsd required' }, { status: 400 });
    }
    const row = await upsertBudgetPolicy({
      id: body.id,
      orgId,
      scope: body.scope,
      amountUsd: body.amountUsd,
      period: body.period ?? 'monthly',
      mode: body.mode ?? 'soft',
      alertPct: body.alertPct ?? 80,
      alertEmail: body.alertEmail,
    });
    const [policies, statuses] = await Promise.all([listBudgetPolicies(orgId), getBudgetStatuses(orgId)]);
    return NextResponse.json({ policy: row, policies, statuses });
  } catch (err) {
    console.error('[admin/cost/budgets PUT]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
