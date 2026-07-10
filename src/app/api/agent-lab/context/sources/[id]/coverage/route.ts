import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getSourceCoverage } from '@/lib/context/reads';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'BAD_REQUEST', field: 'id' }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();

    // Verify source exists in the org
    const sourceExists = await prisma.platformContextSource.findFirst({
      where: { id, org_id: org.id },
      select: { id: true },
    });

    if (!sourceExists) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const result = await getSourceCoverage(org.id, id);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[context/sources/:id/coverage GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
