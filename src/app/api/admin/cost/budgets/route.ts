import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessSection } from '@/lib/sections/server';
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
  const denied = await denyUnlessSection(null, ['govern.cost', 'view']);
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
  const denied = await denyUnlessSection(null, ['govern.cost', 'manage']);
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
    if (!Number.isFinite(body.amountUsd) || body.amountUsd < 0) {
      return NextResponse.json({ error: 'amountUsd must be a non-negative number' }, { status: 400 });
    }
    if (body.alertPct != null && (!Number.isInteger(body.alertPct) || body.alertPct < 1 || body.alertPct > 100)) {
      return NextResponse.json({ error: 'alertPct must be an integer from 1 to 100' }, { status: 400 });
    }
    if (body.period && body.period !== 'monthly' && body.period !== 'daily') {
      return NextResponse.json({ error: 'period must be monthly or daily' }, { status: 400 });
    }
    if (body.mode && body.mode !== 'soft' && body.mode !== 'hard') {
      return NextResponse.json({ error: 'mode must be soft or hard' }, { status: 400 });
    }
    // New policies must use a scope the enforcement code reads (see pickUserInteractivePolicy in budgets.ts).
    // `role-total:` is the combined cap for a role (read by assertInteractiveBudget).
    if (!body.id && !/^(org:[^:]+:(interactive|harvest)|role(-total)?:[a-z_]+:interactive|user:[^:]+:interactive)$/.test(body.scope)) {
      return NextResponse.json({ error: 'Unsupported budget scope' }, { status: 400 });
    }
    if (body.alertEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.alertEmail)) {
      return NextResponse.json({ error: 'alertEmail is not a valid address' }, { status: 400 });
    }
    if (!body.id) {
      const existing = (await listBudgetPolicies(orgId)).find((p) => p.scope === body.scope);
      if (existing) {
        return NextResponse.json({ error: 'A policy for this scope already exists — edit it instead.' }, { status: 409 });
      }
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
