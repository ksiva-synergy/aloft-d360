import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { flattenPermissions, userAuthInclude, resolveRoleLabel, PERMISSIONS } from '@/lib/rbac';
import { getDashboardSummary } from '@/lib/dashboard/summary';
import { DashboardView } from '@/components/dashboard/DashboardView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard · ALOFT',
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

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

  return (
    <DashboardView
      summary={summary}
      displayName={displayName}
      roleLabel={roleLabel}
      canReadUsers={canReadUsers}
    />
  );
}
