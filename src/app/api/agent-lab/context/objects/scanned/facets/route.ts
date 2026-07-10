import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listScannedFacets } from '@/lib/context/reads';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  excludeTestSources: z.string().optional().transform(v => v === 'true'),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();
    const result = await listScannedFacets(org.id, {
      excludeTestSources: parsed.data.excludeTestSources ?? false,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[context/objects/scanned/facets GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
