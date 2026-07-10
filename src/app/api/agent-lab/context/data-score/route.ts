import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { computeSourceDistribution } from '@/lib/context/data-score/distribution';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sourceId = searchParams.get('sourceId');

  if (!sourceId) {
    return NextResponse.json({ error: 'BAD_REQUEST', field: 'sourceId' }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();

    // Verify source belongs to this org before computing.
    // Returns 404 for wrong-org sourceId — don't leak existence.
    const sourceExists = await prisma.platformContextSource.findFirst({
      where: { id: sourceId, org_id: org.id },
      select: { id: true },
    });

    if (!sourceExists) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const result = await computeSourceDistribution(org.id, sourceId);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[context/data-score GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
