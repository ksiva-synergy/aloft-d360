import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import { reconstructSession } from '@/lib/memory/trace/reconstruct';
import { prisma } from '@/lib/prisma';
import { canAccessSessionMemory, forbidden, requireMemoryCaller } from '@/lib/memory/curation-access';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await requireMemoryCaller();
  if (caller instanceof NextResponse) return caller;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'BAD_REQUEST', message: 'Missing session ID' }, { status: 400 });
  }
  if (!(await canAccessSessionMemory(caller, id))) return forbidden();

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
