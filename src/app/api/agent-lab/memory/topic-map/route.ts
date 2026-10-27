import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getCurrentTopicMap } from '@/lib/foer/topics';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent-lab/memory/topic-map
 *
 * The current-period topic map (`taskSignature -> { topicKey, topicName, rank }`) that
 * `memory/ops/page.tsx` used to load on the server and pass to `FoerOpsDashboard`.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    const topicMap = await getCurrentTopicMap(org.id);
    return NextResponse.json({ topicMap: Object.fromEntries(topicMap) });
  } catch (err) {
    console.error('[memory/topic-map GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
