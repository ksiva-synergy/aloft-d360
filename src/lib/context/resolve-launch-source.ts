import 'server-only';

import prisma from '@/lib/db';

export class LaunchSourceNotFoundError extends Error {
  constructor() {
    super('Active context source not found for launch');
    this.name = 'LaunchSourceNotFoundError';
  }
}

/** Resolve which source(s) a plan/launch request targets (P1-14). */
export async function resolveLaunchSources(
  orgId: string,
  sourceId?: string | null,
): Promise<Array<{ id: string; display_name: string | null; connection_kind: string }>> {
  if (sourceId) {
    const row = await prisma.platformContextSource.findFirst({
      where: { id: sourceId, org_id: orgId, status: 'active' },
      select: { id: true, display_name: true, connection_kind: true },
    });
    if (!row) throw new LaunchSourceNotFoundError();
    return [row];
  }

  return prisma.platformContextSource.findMany({
    where: { org_id: orgId, status: 'active' },
    select: { id: true, display_name: true, connection_kind: true },
    orderBy: { created_at: 'asc' },
  });
}

export function filterSourcesForJobKind(
  sources: Array<{ id: string; display_name: string | null; connection_kind: string }>,
  kind: string,
): Array<{ id: string; display_name: string | null; connection_kind: string }> {
  if (kind.startsWith('pbi_')) {
    return sources.filter((s) => s.connection_kind === 'powerbi');
  }
  return sources.filter((s) => s.connection_kind !== 'powerbi');
}
