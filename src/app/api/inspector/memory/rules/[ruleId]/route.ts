import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { retireMyRule } from '@/lib/memory/teach';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/inspector/memory/rules/[ruleId]  (Phase 3.5D)
 *
 * Retire a rule the caller taught (soft delete → status SUPERSEDED, so it stops
 * injecting). Owner-scoped: only the rule's author may retire it.
 */
export async function DELETE(
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

    const ok = await retireMyRule(ruleId, org.id, currentUser.id);
    if (!ok) return NextResponse.json({ error: 'rule not found or not yours' }, { status: 404 });
    return NextResponse.json({ retired: true });
  } catch (err) {
    console.error('[memory/rules DELETE]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
