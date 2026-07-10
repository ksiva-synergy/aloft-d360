import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'BAD_REQUEST', field: 'id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const status = typeof body.status === 'string' ? body.status.trim() : '';

  if (status !== 'confirmed' && status !== 'rejected') {
    return NextResponse.json(
      { error: 'INVALID_STATUS', message: "Status must be 'confirmed' or 'rejected'" },
      { status: 409 },
    );
  }

  let orgId: string;
  try {
    const org = await getDefaultOrg();
    orgId = org.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Could not resolve org: ${msg}` }, { status: 500 });
  }

  try {
    // 3. Fetch mapping by id WHERE org_id = orgId
    const mapping = await prisma.platformContextMapping.findFirst({
      where: { id, org_id: orgId },
    });

    if (!mapping) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // 5. Validate current status is proposed
    if (mapping.status !== 'proposed') {
      return NextResponse.json(
        {
          error: 'INVALID_TRANSITION',
          current: mapping.status,
          requested: status,
        },
        { status: 409 },
      );
    }

    const reviewedBy = session.user?.email || 'unknown';

    // C4-LITE INVARIANT: 'confirmed' status may only be set
    // here and in /silo/links/[id] PATCH. No other code path
    // may write 'confirmed'. See D-1 / PHASE_CH11_DECISIONS.
    const updatedMapping = await prisma.platformContextMapping.update({
      where: { id },
      data: {
        status,
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
      },
    });

    return NextResponse.json({ data: updatedMapping });
  } catch (err) {
    console.error('[context/mappings/:id PATCH]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
