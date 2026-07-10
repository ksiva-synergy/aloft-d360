import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const org = await getDefaultOrg();

    const run = await prisma.platformMemorySynthesisRun.findFirst({
      where: { id, orgId: org.id },
    });

    if (!run) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const details = await prisma.platformMemorySynthesisDetail.findMany({
      where:   { runId: id, orgId: org.id },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ run, details });
  } catch (err) {
    console.error('[memory/runs/[id] GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
