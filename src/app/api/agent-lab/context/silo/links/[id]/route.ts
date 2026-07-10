import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { enqueue } from '@/lib/context/queue';
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

  let orgId: string;
  try {
    const org = await getDefaultOrg();
    orgId = org.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Could not resolve org: ${msg}` }, { status: 500 });
  }

  try {
    // 1. Fetch link by id WHERE org_id = orgId
    const link = await prisma.platformContextObjectLink.findFirst({
      where: { id, org_id: orgId },
    });

    if (!link) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // 2. Validate requested status is valid
    if (status !== 'confirmed' && status !== 'rejected') {
      return NextResponse.json(
        {
          error: 'INVALID_TRANSITION',
          current: link.status,
          requested: status,
        },
        { status: 409 },
      );
    }

    // 3. Validate current status is proposed
    if (link.status !== 'proposed') {
      return NextResponse.json(
        {
          error: 'INVALID_TRANSITION',
          current: link.status,
          requested: status,
        },
        { status: 409 },
      );
    }

    const reviewedBy = session.user?.email || 'unknown';

    // C4-LITE INVARIANT: 'confirmed' status may only be set
    // here and in /mappings/[id] PATCH. No other code path
    // may write 'confirmed'. See D-1 / PHASE_CH11_DECISIONS.
    const updatedLink = await prisma.platformContextObjectLink.update({
      where: { id },
      data: {
        status,
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
      },
    });

    // 4. On confirm, enqueue entity tag recompute
    if (status === 'confirmed') {
      await enqueue('recompute_entity_tags', null, { orgId }, 'on_demand', orgId);

      // D-24: Only fire process synchronously in development env
      if (process.env.NODE_ENV === 'development') {
        const processUrl = new URL('/api/agent-lab/context/process', req.url).toString();
        const cookie = req.headers.get('cookie') ?? '';
        void fetch(processUrl, {
          method: 'POST',
          headers: {
            cookie,
            'content-type': 'application/json',
          },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ data: updatedLink });
  } catch (err) {
    console.error('[context/silo/links/:id PATCH]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
