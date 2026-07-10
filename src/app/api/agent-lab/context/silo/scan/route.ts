import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { enqueue } from '@/lib/context/queue';
import prisma from '@/lib/db';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const scanSchema = z.object({
  objectId: z.string().uuid(),
  topN: z.number().int().min(5).max(50).optional(),
  minScore: z.number().min(0).max(1).optional(),
  includeRejected: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = scanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  const { objectId, topN, minScore, includeRejected } = parsed.data;

  let orgId: string;
  try {
    const org = await getDefaultOrg();
    orgId = org.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Could not resolve org: ${msg}` }, { status: 500 });
  }

  try {
    // Verify object exists in this org
    const obj = await prisma.platformContextObject.findFirst({
      where: { id: objectId, org_id: orgId, lifecycle: 'active' },
    });
    if (!obj) {
      return NextResponse.json({ error: 'Object not found or does not belong to your org.' }, { status: 404 });
    }

    const job = await enqueue(
      'silo_scan',
      null,
      { objectId, orgId, topN, minScore, includeRejected },
      'on_demand',
      orgId,
    );

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

    return NextResponse.json({ data: { jobId: job.id } }, { status: 202 });
  } catch (err) {
    console.error('[silo/scan POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
