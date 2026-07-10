import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { computeJobHealth } from '@/lib/memory/jobHealth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const org = await getDefaultOrg();
    const report = await computeJobHealth(org.id);
    return NextResponse.json(report);
  } catch (err) {
    console.error('[memory/job-health GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
