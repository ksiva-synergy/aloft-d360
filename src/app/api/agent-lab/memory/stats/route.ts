import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { computeMemoryStats } from '@/lib/foer/stats';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    const stats = await computeMemoryStats(org.id);
    return NextResponse.json(stats);
  } catch (err) {
    console.error('[memory/stats GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
