import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { flattenPermissions, userAuthInclude, resolveRoleLabel, PERMISSIONS } from '@/lib/rbac';
import { getDashboardSummary } from '@/lib/dashboard/summary';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/summary
 *
 * Everything `(agent)/dashboard/page.tsx` used to compute on the server, as JSON, so the
 * browser-only (Vite) UI can render the same `DashboardView`. Same permission rules as the page.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: userAuthInclude,
    });
    const permissions = dbUser ? flattenPermissions(dbUser) : new Set<string>();
    const canReadUsers = permissions.has(PERMISSIONS.USER_READ);

    const summary = await getDashboardSummary({ canReadUsers }, session.user.id);

    const displayName =
      dbUser?.name?.trim() || session.user.name?.trim() || (dbUser?.email ?? '').split('@')[0] || 'there';
    const roleLabel = resolveRoleLabel(session.user.role ?? 'readonly');

    return NextResponse.json({ summary, displayName, roleLabel, canReadUsers });
  } catch (err) {
    console.error('[dashboard/summary GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
