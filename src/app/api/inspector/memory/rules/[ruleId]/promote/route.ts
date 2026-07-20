import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { promoteRuleToOrg } from '@/lib/memory/teach';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/memory/rules/[ruleId]/promote  (Phase 3.5D)
 *
 * Promote a personal rule to org-wide. Reputation-gated (admin or self-approve-
 * eligible author) via the shared promotion-gate; on success the author is
 * credited semantic_authoring reputation. Returns 403 when the gate blocks.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const org = await getDefaultOrg();
    const { ruleId } = await params;

    const result = await promoteRuleToOrg(ruleId, org.id, currentUser.id);
    if (!result.ok) {
      const status = result.reason === 'rule not found' ? 404 : 403;
      return NextResponse.json({ error: `not promoted — ${result.reason}` }, { status });
    }
    return NextResponse.json({ promoted: true, reason: result.reason });
  } catch (err) {
    console.error('[memory/rules/promote POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
