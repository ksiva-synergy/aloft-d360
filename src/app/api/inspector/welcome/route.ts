import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import { resolveInspectorPrincipal } from '@/lib/inspector/session-auth';
import { getOrgWelcomeCatalog } from '@/lib/inspector/welcome-cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/welcome
 *
 * Org-wide business domains (Crewing, Marine, Finance, …) from harvested metadata.
 * Cached in memory per org; discover/SQL access is still enforced per user at query time.
 */
export async function GET(req: NextRequest) {
  const principal = await resolveInspectorPrincipal(req);
  if (principal?.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    return NextResponse.json(await getOrgWelcomeCatalog(org.id));
  } catch (err) {
    console.error('[inspector/welcome GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
