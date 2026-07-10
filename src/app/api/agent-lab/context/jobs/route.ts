import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { listJobsPage } from '@/lib/context/reads';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  kind: z.string().optional(),
  status: z.string().optional(),
  sourceId: z.string().uuid().optional(),
  after: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }).optional(),
  before: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }).optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  pageSize: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const rawParams = Object.fromEntries(searchParams.entries());

  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST', details: parsed.error.format() }, { status: 400 });
  }

  try {
    const org = await getDefaultOrg();
    const result = await listJobsPage(org.id, parsed.data);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[context/jobs GET]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
