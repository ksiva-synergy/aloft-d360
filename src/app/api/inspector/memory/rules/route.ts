import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { teachRule, listMyRules, type TeachableRuleType } from '@/lib/memory/teach';

export const dynamic = 'force-dynamic';

const VALID_RULE_TYPES: TeachableRuleType[] = ['SCHEMA_MAP', 'HARD_RULE', 'HEURISTIC', 'SOURCE_PREF', 'FAILURE_MODE'];

/**
 * /api/inspector/memory/rules  (Phase 3.5D — coaching)
 *
 * GET  — the caller's own taught rules (personal + promoted-to-org).
 * POST — teach a new PERSONAL standing rule (free). Body: { ruleText, ruleType? }.
 *        Org-wide promotion is a separate reputation-gated step (see
 *        rules/[id]/promote).
 */

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const org = await getDefaultOrg();
    const rules = await listMyRules(org.id, currentUser.id);
    return NextResponse.json({ rules });
  } catch (err) {
    console.error('[memory/rules GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const org = await getDefaultOrg();
    const body = (await request.json()) as { ruleText?: unknown; ruleType?: unknown };
    const ruleText = typeof body.ruleText === 'string' ? body.ruleText.trim() : '';
    if (!ruleText) {
      return NextResponse.json({ error: 'ruleText is required' }, { status: 400 });
    }
    if (ruleText.length > 500) {
      return NextResponse.json({ error: 'ruleText must be 500 characters or fewer' }, { status: 400 });
    }
    const ruleType =
      typeof body.ruleType === 'string' && VALID_RULE_TYPES.includes(body.ruleType as TeachableRuleType)
        ? (body.ruleType as TeachableRuleType)
        : undefined;

    const rule = await teachRule({ orgId: org.id, userId: currentUser.id, ruleText, ruleType });
    return NextResponse.json({ created: true, rule }, { status: 201 });
  } catch (err) {
    console.error('[memory/rules POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
