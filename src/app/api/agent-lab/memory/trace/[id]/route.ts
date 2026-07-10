import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { reconstructSession } from '@/lib/memory/trace/reconstruct';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'BAD_REQUEST', message: 'Missing session ID' }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();

    // Fetch trace walk, active bullets, and superseded bullets in parallel
    const [trace, bullets, supersededBullets] = await Promise.all([
      reconstructSession(org.id, id),
      prisma.platformAgentMemory.findMany({
        where: {
          orgId: org.id,
          sourceSessionIds: { has: id },
          status: 'ACTIVE',
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.platformAgentMemory.findMany({
        where: {
          orgId: org.id,
          sourceSessionIds: { has: id },
          status: 'SUPERSEDED',
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return NextResponse.json({ trace, bullets, supersededBullets });
  } catch (err) {
    console.error('[trace GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
