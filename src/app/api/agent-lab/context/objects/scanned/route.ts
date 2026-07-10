import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listScannedObjects } from '@/lib/context/reads';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  sourceId: z.string().uuid().optional(),
  kind: z.string().optional(),
  tier: z.enum(['t0', 't1', 't2', 'embed', 't3', 't4']).optional(),
  catalog: z.string().optional(),
  schema: z.string().optional(),
  q: z.string().optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  pageSize: z.string().regex(/^\d+$/).transform(Number).optional(),
  excludeTestSources: z.string().optional().transform(v => v === 'true'),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();
    const result = await listScannedObjects(org.id, parsed.data);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[context/objects/scanned GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
