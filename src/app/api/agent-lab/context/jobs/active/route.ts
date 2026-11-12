import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { listActiveJobs } from '@/lib/context/active-jobs';
import { z } from 'zod';
import { denyUnlessSection } from '@/lib/sections/server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  sourceId: z.string().uuid().optional(),
  kind: z.string().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export async function GET(req: NextRequest) {
  const deniedSection = await denyUnlessSection(req, ['estate.jobs', 'view']);
  if (deniedSection) return deniedSection;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  try {
    const orgId = await getOrgId();
    const items = await listActiveJobs(orgId, {
      sourceId: parsed.data.sourceId,
      kind: parsed.data.kind,
      limit: parsed.data.limit,
    });
    return NextResponse.json({ data: items, total: items.length });
  } catch (err) {
    console.error('[context/jobs/active GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
